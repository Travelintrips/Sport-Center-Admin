export const ACTIVE_ENVIRONMENT_RECORD_NOT_FOUND = "RECORD_NOT_FOUND_IN_ACTIVE_ENVIRONMENT";

/**
 * Diagnostics are scoped to the selected connection. This helper deliberately
 * has no cross-environment lookup path.
 */
export function activeEnvironmentLookupResult(rowCount: number, requestedPaymentId: number) {
  return rowCount > 0
    ? { requestedPaymentId, activeEnvironmentRecordFound: true }
    : {
        error: ACTIVE_ENVIRONMENT_RECORD_NOT_FOUND,
        requestedPaymentId,
        activeEnvironmentRecordFound: false,
      };
}