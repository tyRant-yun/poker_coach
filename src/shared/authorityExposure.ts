// A read projection of the local authority, never an independent exposure ledger.
let possible = false;
export const hasAuthorityExposure = () => possible;
export function projectAuthorityExposure(value: boolean) {
  possible = value;
}
