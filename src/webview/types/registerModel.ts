export interface RegisterModel {
  name?: string;
  offset?: number | string;
  address_offset?: number | string;
  __kind?: string;
  count?: number;
  stride?: number;
  access?: string;
  description?: string;
  registers?: RegisterModel[];
  fields?: unknown[];
  [key: string]: unknown;
}
