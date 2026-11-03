// Only data types used by the selected upstream files. Browser config/eval is not included.
export type ConfigValue = string | number | boolean | string[];
export interface NamedConfigEntry { id: string; [key: string]: unknown }
