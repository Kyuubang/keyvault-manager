import { isSecretName } from "./validate.js";

const IDENTITY = (expr: string) => `coalesce(
      tostring(${expr}.claim.upn),
      tostring(${expr}.claim["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn"]),
      tostring(${expr}.claim.appid),
      tostring(${expr}.claim.oid),
      tostring(${expr}.claim["http://schemas.microsoft.com/identity/claims/objectidentifier"]))`;

/** KQL over both the resource-specific (AZKVAuditLogs) and legacy (AzureDiagnostics) tables. */
export function buildAuditQuery(secretName?: string): string {
  if (secretName !== undefined && !isSecretName(secretName)) throw new Error("Invalid secret name");
  const filter = secretName
    ? `| where Target matches regex @"(?i)/secrets/${secretName}(/|$|\\?)" or RequestUri matches regex @"(?i)/secrets/${secretName}(/|$|\\?)"`
    : "";
  return `union isfuzzy=true
(AZKVAuditLogs
  | extend Ident = column_ifexists("Identity", dynamic(null))
  | project TimeGenerated,
      OperationName = tostring(column_ifexists("OperationName", "")),
      Result = tostring(column_ifexists("ResultSignature", "")),
      StatusCode = tostring(column_ifexists("HttpStatusCode", "")),
      CallerIp = tostring(column_ifexists("CallerIpAddress", "")),
      Caller = ${IDENTITY("Ident")},
      Target = tostring(column_ifexists("Id", "")),
      RequestUri = tostring(column_ifexists("RequestUri", "")),
      Client = tostring(column_ifexists("ClientInfo", ""))),
(AzureDiagnostics
  | where ResourceType == "VAULTS"
  | project TimeGenerated,
      OperationName = tostring(column_ifexists("OperationName", "")),
      Result = tostring(column_ifexists("ResultSignature", "")),
      StatusCode = tostring(toint(column_ifexists("httpStatusCode_d", real(null)))),
      CallerIp = tostring(column_ifexists("CallerIPAddress", "")),
      Caller = coalesce(
        tostring(column_ifexists("identity_claim_upn_s", "")),
        tostring(column_ifexists("identity_claim_http_schemas_xmlsoap_org_ws_2005_05_identity_claims_upn_s", "")),
        tostring(column_ifexists("identity_claim_appid_g", "")),
        tostring(column_ifexists("identity_claim_oid_g", "")),
        tostring(column_ifexists("identity_claim_http_schemas_microsoft_com_identity_claims_objectidentifier_g", ""))),
      Target = tostring(column_ifexists("id_s", "")),
      RequestUri = tostring(column_ifexists("requestUri_s", "")),
      Client = tostring(column_ifexists("clientInfo_s", "")))
${filter}
| sort by TimeGenerated desc
| take 500`;
}

export interface LaTable {
  columns: { name: string }[];
  rows: unknown[][];
}

export function tableToObjects(table: LaTable | undefined): Record<string, unknown>[] {
  if (!table) return [];
  return table.rows.map((row) => Object.fromEntries(table.columns.map((c, i) => [c.name, row[i]])));
}
