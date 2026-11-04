/**
 * Password login through Instagram's current "CAA" bloks flow, with its
 * two-factor routes. Ported from instagrapi (bloks.py, auth.py,
 * attestation.py; MIT, see NOTICE) via the CAA probe that verified the flow
 * live from Node up to the two-factor prompt.
 *
 * The flow is split for the MCP tools: start() runs everything up to the
 * point where a verification code is needed and returns the pending state;
 * submitCode() finishes it. The password is submitted exactly once.
 */

import { randomUUID } from "node:crypto";
import {
  AP_2SV_CODE_ENTRY,
  AP_2SV_CODE_ENTRY_ASYNC,
  AP_2SV_ENTRYPOINT,
  bloksHints,
  extractAac,
  extractContextData,
  extractLoginResponse,
  extractTwoStepVerificationContext,
  inferTwoFactorMethod,
  needsProfileCode,
} from "./bloks.js";
import type { InstagramClient } from "./client.js";
import { pyDumps } from "./encoding.js";
import { IgError } from "./errors.js";
import { encryptPassword } from "./password.js";
import { usdidRegistrationToken } from "./usdid.js";

export const CAA_DOMAIN = "b.i.instagram.com";
const OFFLINE_EXPERIMENT_GROUP = "caa_iteration_v3_perf_ig_4";
const QPL_MARKER_ID = 36707139;
const USDID_REGISTRATION_CLIENT_DOC_ID = "124930351917786857261002920888";
const ATTESTATION_KEYSTORE_ERROR = -1013;
const FLOW_SOURCE = "two_factor_login";

/** The CAA flow could not complete; `hints` are non-secret markers from the response. */
export class IgLoginFlowError extends IgError {
  constructor(message: string, readonly hints: Record<string, unknown> = {}) {
    super(message);
  }
}

/** Instagram asked to continue with the legacy accounts/login flow, which it now rejects. */
export class IgLoginFallbackError extends IgLoginFlowError {}

/** The verification code was not accepted (wrong or expired). */
export class IgTwoFactorCodeError extends IgLoginFlowError {}

export type TwoFactorMethod = "profile_code" | "totp" | "sms" | "backup_codes";

export interface PendingTwoFactor {
  route: "profile_code" | "two_step_verification";
  method: TwoFactorMethod;
  /** profile_code: context of the code_entry_async submission. two_step: two_step_verification_context. */
  context: string;
  aac: string;
  /** Where Instagram most likely sent the code, for the prompt shown to the user. */
  delivery: "email" | "sms" | "authenticator" | "unknown";
  createdAt: number;
}

export type LoginStart = { status: "logged_in" } | { status: "two_factor"; pending: PendingTwoFactor };

type Json = Record<string, unknown>;

/** Fixed network description the Android app reports (bloks.py:471-495). */
function networkInfo(): Json {
  return {
    active_subscriptions_info: null,
    default_subscription_info: {
      network_type: null, is_data_roaming: 1, is_esim: null, is_gsm_roaming: 0, is_sim_sms_capable: null,
      is_mobile_data_enabled: 1, sim_carrier_id: 1, sim_carrier_id_name: null, sim_state: 5, sim_operator: "310260",
      sim_operator_name: "T-Mobile", signal_strength: null, group_id_level_1: null, network_operator: "310260",
    },
    is_airplane_mode: 0, is_active_network_cellular: 0, is_device_sms_capable: 1, sim_count: 1, is_wifi: 1,
  };
}

const looksLikeBackupCode = (code: string): boolean => /^\d{8}$/.test(code.trim().replace(/[\s-]+/g, ""));

export class CaaLogin {
  private passwordSubmitted = false;

  /**
   * @param paceMs instagrapi waits 1 s before requests not flagged as login
   *   steps (the two-step screens); tests pass 0.
   */
  constructor(private readonly client: InstagramClient, private readonly paceMs = 1000) {}

  private async pace(): Promise<void> {
    if (this.paceMs > 0) await new Promise((resolve) => setTimeout(resolve, this.paceMs));
  }

  private bloksForm(params: Json): Json {
    const version = this.client.device.bloksVersionId;
    return {
      params: pyDumps(params),
      _uuid: this.client.device.uuid,
      bk_client_context: pyDumps({ bloks_version: version, styles_id: "instagram" }),
      bloks_versioning_id: version,
    };
  }

  private bloksAsync(action: string, params: Json, options: { domain?: string; headers?: Record<string, string> } = {}) {
    return this.client.request<Json>({
      method: "POST",
      path: `bloks/async_action/${action}/`,
      form: this.bloksForm(params),
      signed: false,
      domain: options.domain,
      headers: { "X-FB-Friendly-Name": `IgApi: bloks/async_action/${action}/`, ...(options.headers ?? {}) },
    });
  }

  private bloksApp(app: string, params: Json, options: { domain?: string } = {}) {
    return this.client.request<Json>({
      method: "POST",
      path: `bloks/apps/${app}/`,
      form: this.bloksForm(params),
      signed: false,
      domain: options.domain,
    });
  }

  /** Registers the device's USDID key (IGUSDIDRegistrationMutation) once per device. */
  private async registerUsdid(): Promise<void> {
    const usdid = this.client.ensureUsdid();
    if (usdid.registered) return;
    await this.pace(); // instagrapi's graphql_www always waits first
    const variables = {
      input: {
        usdid_token: { sensitive_string_value: usdidRegistrationToken(usdid) },
        fdid: { sensitive_string_value: this.client.device.phoneId },
      },
    };
    const result = await this.client.request<Json>({
      method: "POST",
      path: "/graphql_www",
      domain: CAA_DOMAIN,
      signed: false,
      ndjson: true,
      form: {
        method: "post", pretty: "false", format: "json", server_timestamps: "true", locale: "user",
        fb_api_req_friendly_name: "IGUSDIDRegistrationMutation", enable_canonical_naming: "true",
        enable_canonical_variable_overrides: "true", enable_canonical_naming_ambiguous_type_prefixing: "true",
        variables: pyDumps(variables), purpose: "fetch", client_doc_id: USDID_REGISTRATION_CLIENT_DOC_ID,
      },
      headers: {
        "X-FB-Friendly-Name": "IGUSDIDRegistrationMutation",
        "X-Client-Doc-Id": USDID_REGISTRATION_CLIENT_DOC_ID,
        "X-Root-Field-Name": "usdid_registration",
        "X-Graphql-Client-Library": "pando",
      },
    });
    if (result.errors && (!Array.isArray(result.errors) || result.errors.length > 0)) {
      throw new IgLoginFlowError("Instagram rejected the device registration (GraphQL errors).");
    }
    const data = result.data && typeof result.data === "object" ? (result.data as Json) : {};
    const registration = Object.entries(data).find(([key, value]) => key.includes("usdid_registration") && value && typeof value === "object");
    if (!(registration && (registration[1] as Json).success)) {
      throw new IgLoginFlowError("Instagram did not confirm the device registration; no password was sent.");
    }
    this.client.markUsdidRegistered();
  }

  /** Pre-login: launcher/sync supplies the password encryption key and the machine id. */
  private async fetchPasswordKey(): Promise<void> {
    try {
      await this.client.request({
        method: "POST",
        path: "launcher/sync/",
        form: { id: this.client.device.uuid, server_config_retrieval: "1" },
      });
    } catch {
      // The key headers may still have arrived; checked below.
    }
    if (!this.client.passwordEncryptionKey) {
      throw new IgLoginFlowError("Instagram did not provide a password encryption key; no password was sent.");
    }
  }

  /** process_client_data, keystore attestation nonce and OAuth token preflight. */
  private async prepare(username: string): Promise<{ aac: string; challengeNonce: string; waterfallId: string }> {
    const { phoneId, androidId, uuid } = this.client.device;
    await this.registerUsdid();
    const waterfallId = randomUUID();
    const clientData = await this.bloksAsync(
      "com.bloks.www.bloks.caa.login.process_client_data_and_redirect",
      {
        is_from_logged_out: false, logged_out_user: "", qpl_join_id: null, family_device_id: phoneId, device_id: androidId,
        offline_experiment_group: OFFLINE_EXPERIMENT_GROUP, waterfall_id: waterfallId, logout_source: "",
        show_internal_settings: false, last_auto_login_time: 0, disable_auto_login: false, qe_device_id: uuid,
        use_auto_login_interstitial: true, disable_recursive_auto_login_interstitial: true,
        auto_login_interstitial_experiment_group_name: "", is_from_logged_in_switcher: false, switcher_logged_in_uid: "",
        account_list: [], blocked_uid: [], INTERNAL_INFRA_THEME: "THREE_NEUTRAL_GRAY",
        layered_homepage_experiment_group: "Deploy: Not in Experiment", launched_url: "", sim_phone_numbers: [],
        is_from_registration_reminder: false,
      },
      { domain: CAA_DOMAIN }
    );
    const aac = extractAac(clientData);
    const keystore = await this.client.request<Json>({
      method: "POST",
      path: "attestation/create_android_keystore/",
      domain: CAA_DOMAIN,
      signed: false,
      form: { app_scoped_device_id: uuid, key_hash: "" },
      headers: { "X-FB-Friendly-Name": "IgApi: attestation/create_android_keystore/" },
    });
    const challengeNonce = typeof keystore.challenge_nonce === "string" ? keystore.challenge_nonce : String(keystore.challenge_nonce ?? "");
    if (aac) {
      await this.bloksAsync(
        "com.bloks.www.caa.login.oauth.token.fetch.async",
        {
          client_input_params: {
            username_input: username, si_device_param_network_info: networkInfo(), aac,
            lois_settings: { lois_token: "" }, cloud_trust_token: null, zero_balance_state: "", network_bssid: null,
          },
          server_params: {
            is_from_logged_out: 0, layered_homepage_experiment_group: "Deploy: Not in Experiment", device_id: androidId,
            login_surface: "login_home", waterfall_id: waterfallId, INTERNAL__latency_qpl_instance_id: Date.now(),
            is_platform_login: 0, login_entry_point: "logged_out", INTERNAL__latency_qpl_marker_id: QPL_MARKER_ID,
            family_device_id: phoneId, offline_experiment_group: OFFLINE_EXPERIMENT_GROUP,
            access_flow_version: "pre_mt_behavior", is_from_logged_in_switcher: 0, qe_device_id: uuid,
          },
        },
        { domain: CAA_DOMAIN }
      );
    }
    if (!aac || !challengeNonce || challengeNonce === "undefined") {
      throw new IgLoginFlowError(
        "Instagram's login preflight did not return the expected account context; no password was sent."
      );
    }
    return { aac, challengeNonce, waterfallId };
  }

  private async sendLoginRequest(
    username: string,
    password: string,
    prepared: { aac: string; challengeNonce: string; waterfallId: string }
  ): Promise<Json> {
    if (this.passwordSubmitted) {
      throw new IgLoginFlowError("Refusing to submit the password twice in one login attempt.");
    }
    const key = this.client.passwordEncryptionKey;
    if (!key) throw new IgLoginFlowError("No password encryption key; no password was sent.");
    const { phoneId, androidId, uuid } = this.client.device;
    const textInputId = `${randomUUID().replaceAll("-", "").slice(0, 4)}ig`;
    const params = {
      client_input_params: {
        blocked_uids: [], aac: prepared.aac, sim_phones: [], aymh_accounts: [], network_bssid: null,
        secure_family_device_id: "", has_granted_read_contacts_permissions: 0, auth_secure_device_id: "",
        has_whatsapp_installed: 0, si_device_param_network_info: networkInfo(), password: encryptPassword(password, key),
        sso_token_map_json_string: "", block_store_machine_id: "", ig_vetted_device_nonces: null, cloud_trust_token: null,
        event_flow: "login_manual", password_contains_non_ascii: String(!/^[\x00-\x7f]*$/.test(password)),
        client_known_key_hash: "", sso_accounts_auth_data: [], encrypted_msisdn: "",
        has_granted_read_phone_permissions: 0, app_manager_id: "", should_show_nested_nta_from_aymh: 0,
        device_id: androidId, zero_balance_state: "", login_attempt_count: 1, machine_id: this.client.machineId ?? null,
        flash_call_permission_status: { READ_PHONE_STATE: "DENIED", READ_CALL_LOG: "DENIED", ANSWER_PHONE_CALLS: "DENIED" },
        accounts_list: [], gms_incoming_call_retriever_eligibility: "eligible", family_device_id: phoneId,
        fb_ig_device_id: [], device_emails: [], try_num: 1, lois_settings: { lois_token: "" }, event_step: "home_page",
        headers_infra_flow_id: "", openid_tokens: {}, contact_point: username,
      },
      server_params: {
        should_trigger_override_login_2fa_action: 0, is_from_logged_out: 0,
        should_trigger_override_login_success_action: 0, login_credential_type: "none", server_login_source: "login",
        waterfall_id: prepared.waterfallId, two_step_login_type: "one_step_login", login_source: "Login",
        is_platform_login: 0, login_entry_point: "logged_out", INTERNAL__latency_qpl_marker_id: QPL_MARKER_ID,
        is_from_aymh: 0, offline_experiment_group: OFFLINE_EXPERIMENT_GROUP, is_from_landing_page: 0,
        left_nav_button_action: "NONE", password_text_input_id: `${textInputId}:82`, is_from_empty_password: 0,
        is_from_msplit_fallback: 0, ar_event_source: "login_home_page", qe_device_id: uuid,
        username_text_input_id: `${textInputId}:81`, layered_homepage_experiment_group: "Deploy: Not in Experiment",
        device_id: androidId, login_surface: "login_home", INTERNAL__latency_qpl_instance_id: Date.now(),
        reg_flow_source: "login_home_native_integration_point", is_caa_perf_enabled: 1, credential_type: "password",
        is_from_password_entry_page: 0, caller: "gslr", family_device_id: phoneId, is_from_assistive_id: 0,
        access_flow_version: "pre_mt_behavior", is_from_logged_in_switcher: 0,
      },
    };
    const attest = pyDumps({
      attestation: [
        {
          version: 2, type: "keystore", errors: [ATTESTATION_KEYSTORE_ERROR],
          challenge_nonce: prepared.challengeNonce, signed_nonce: "", key_hash: "",
        },
      ],
    });
    // Counted before sending, so even a failed or timed-out request is never repeated.
    this.passwordSubmitted = true;
    return this.bloksAsync("com.bloks.www.bloks.caa.login.async.send_login_request", params, {
      domain: CAA_DOMAIN,
      headers: { "X-IG-Attest-Params": attest },
    });
  }

  /** Applies an embedded login payload to the client; true if it carried a session. */
  private applyLoginResponse(result: unknown): boolean {
    const payload = extractLoginResponse(result);
    if (!payload) return false;
    const cookies = Object.entries(payload.cookies).map(([name, value]) => `${name}=${value}`);
    this.client.absorbResponse(payload.headers, cookies);
    const user = payload.loginResponse.logged_in_user;
    if (user && typeof user === "object") {
      const { pk, pk_id: pkId, username } = user as Json;
      const id = pk ?? pkId;
      if (id !== undefined && id !== null) this.client.setAccount(String(id), typeof username === "string" ? username : undefined);
    }
    return this.client.hasSession;
  }

  /**
   * Submits the password and returns either a logged-in client or the pending
   * two-factor state. Throws IgLoginFlowError subclasses or IgResponseError
   * subclasses (e.g. IgBadPasswordError, IgCheckpointError).
   */
  async start(username: string, password: string): Promise<LoginStart> {
    await this.fetchPasswordKey();
    const prepared = await this.prepare(username);
    const sendResult = await this.sendLoginRequest(username, password, prepared);
    if (this.applyLoginResponse(sendResult)) {
      return { status: "logged_in" };
    }
    const hints = bloksHints(sendResult);

    if (needsProfileCode(sendResult)) {
      return { status: "two_factor", pending: await this.openProfileCode(sendResult, prepared.aac, hints) };
    }
    const context = extractTwoStepVerificationContext(sendResult);
    if (context) {
      return { status: "two_factor", pending: await this.openTwoStep(context, sendResult, prepared.aac) };
    }
    if (hints.fallback) {
      throw new IgLoginFallbackError(
        "Instagram asked to continue with its old login flow, which it no longer accepts from this server. " +
          "Log in with IG_SESSION_ID instead.",
        { markers: hints.fallbackMarkers }
      );
    }
    const label = hints.errorLabels[0];
    throw new IgLoginFlowError(
      `Instagram did not return a session${label ? ` (its response mentions "${label}")` : ""}.`,
      { errorLabels: hints.errorLabels }
    );
  }

  /** Profile-code route (bloks.py:949-1076): opens the code screen; the code goes to submitCode(). */
  private async openProfileCode(
    sendResult: Json,
    aac: string,
    hints: ReturnType<typeof bloksHints>
  ): Promise<PendingTwoFactor> {
    const { phoneId, uuid } = this.client.device;
    const entryContext = extractContextData(sendResult, AP_2SV_ENTRYPOINT);
    if (!entryContext) throw new IgLoginFlowError("Two-factor step: Instagram's response had no entry context.");
    const entry = await this.bloksAsync(
      AP_2SV_ENTRYPOINT,
      {
        client_input_params: {
          auth_secure_device_id: "", accounts_list: [], has_whatsapp_installed: 0, family_device_id: phoneId,
          machine_id: this.client.machineId ?? null,
        },
        server_params: {
          use_open_instead_of_push: 0, context_data: entryContext, INTERNAL__latency_qpl_marker_id: QPL_MARKER_ID,
          INTERNAL__latency_qpl_instance_id: Date.now(), device_id: uuid, use_close_instead_of_back: 0,
        },
      },
      { domain: CAA_DOMAIN }
    );
    const codeContext = extractContextData(entry, AP_2SV_CODE_ENTRY);
    if (!codeContext) throw new IgLoginFlowError("Two-factor step: Instagram's response had no code-entry context.");
    const codeScreen = await this.bloksApp(
      AP_2SV_CODE_ENTRY,
      {
        client_input_params: { aac },
        server_params: {
          context_data: codeContext, show_close_button: 0, device_id: uuid,
          INTERNAL_INFRA_screen_id: "generic_code_entry", is_dismissable: 1,
        },
      },
      { domain: CAA_DOMAIN }
    );
    const submitContext = extractContextData(codeScreen, AP_2SV_CODE_ENTRY_ASYNC);
    if (!submitContext) throw new IgLoginFlowError("Two-factor step: Instagram's response had no submission context.");
    const screenHints = bloksHints(codeScreen);
    return {
      route: "profile_code",
      method: "profile_code",
      context: submitContext,
      aac,
      delivery: hints.emailChallenge || screenHints.emailChallenge ? "email" : "unknown",
      createdAt: Date.now(),
    };
  }

  /** two_step_verification route (auth.py:580-615): opens the method; the code goes to submitCode(). */
  private async openTwoStep(context: string, sendResult: Json, aac: string): Promise<PendingTwoFactor> {
    const { phoneId, androidId } = this.client.device;
    const method = inferTwoFactorMethod({ result: sendResult });
    await this.pace();
    await this.bloksApp("com.bloks.www.two_step_verification.entrypoint", {
      client_input_params: { device_id: androidId, is_whatsapp_installed: 0, machine_id: this.client.machineId ?? null },
      server_params: {
        should_fallback_to_sms: 0, family_device_id: phoneId, device_id: androidId,
        two_step_verification_context: context, flow_source: FLOW_SOURCE,
      },
    });
    await this.pace();
    await this.bloksApp("com.bloks.www.two_step_verification.method_picker", {
      client_input_params: { is_whatsapp_installed: 0 },
      server_params: { should_fallback_to_sms: 0, device_id: androidId, two_step_verification_context: context, flow_source: FLOW_SOURCE },
    });
    await this.selectMethod(context, method);
    return {
      route: "two_step_verification",
      method,
      context,
      aac,
      delivery: method === "sms" ? "sms" : "authenticator",
      createdAt: Date.now(),
    };
  }

  private async selectMethod(context: string, method: TwoFactorMethod): Promise<void> {
    await this.pace();
    await this.bloksAsync("com.bloks.www.two_step_verification.method_picker.navigation.async", {
      client_input_params: { selected_method: method, cloud_trust_token: null, network_bssid: null },
      server_params: {
        should_fallback_to_sms: 0, device_id: this.client.device.androidId, spectra_reg_login_data: null,
        two_step_verification_context: context, flow_source: FLOW_SOURCE,
      },
    });
    if (method === "backup_codes") {
      await this.pace();
      await this.bloksApp("com.bloks.www.two_factor_login.enter_backup_code", {
        server_params: { device_id: this.client.device.androidId, two_step_verification_context: context, flow_source: FLOW_SOURCE },
      });
    }
  }

  /** Submits the verification code for a pending login. On success the client holds the session. */
  async submitCode(pending: PendingTwoFactor, rawCode: string): Promise<void> {
    const code = rawCode.trim().replace(/[\s-]+/g, "");
    const { phoneId, androidId, uuid } = this.client.device;
    let result: Json;
    if (pending.route === "profile_code") {
      result = await this.bloksAsync(
        AP_2SV_CODE_ENTRY_ASYNC,
        {
          client_input_params: {
            auth_secure_device_id: "", aac: pending.aac, code, family_device_id: phoneId, device_id: androidId,
            machine_id: this.client.machineId ?? null,
          },
          server_params: {
            context_data: pending.context, INTERNAL__latency_qpl_marker_id: QPL_MARKER_ID,
            INTERNAL__latency_qpl_instance_id: Date.now(), device_id: uuid,
          },
        },
        { domain: CAA_DOMAIN }
      );
    } else {
      let method = pending.method;
      if (method !== "backup_codes" && looksLikeBackupCode(code)) {
        // An 8-digit code is a backup code (auth.py:533-542).
        method = "backup_codes";
        await this.selectMethod(pending.context, method);
      }
      await this.pace();
      result = await this.bloksAsync("com.bloks.www.two_step_verification.verify_code.async", {
        client_input_params: {
          auth_secure_device_id: "", block_store_machine_id: "", code, should_trust_device: 1, family_device_id: phoneId,
          device_id: androidId, cloud_trust_token: null, network_bssid: null, machine_id: this.client.machineId ?? null,
        },
        server_params: {
          should_fallback_to_sms: 0, device_id: androidId, spectra_reg_login_data: null, challenge: method,
          two_step_verification_context: pending.context, flow_source: FLOW_SOURCE,
        },
      });
    }
    if (!this.applyLoginResponse(result)) {
      throw new IgTwoFactorCodeError("Instagram did not accept the verification code (wrong or expired).");
    }
  }
}
