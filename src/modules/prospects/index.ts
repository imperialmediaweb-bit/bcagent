/**
 * Modulul prospects — API-ul public.
 * Importurile din alte module trec DOAR prin acest index.
 */
export type {
  Prospect,
  ProspectStatus,
  ProspectFilter,
  RawFirmRow,
  ParseFirmsResult,
} from "./types";
export { PROSPECT_STATUSES } from "./types";
export {
  TARGET_CAEN,
  CORE_CAEN,
  DOMAIN_PRESETS,
  TARGET_COUNTIES,
  CAEN_DIVISIONS,
  COUNTY_LIST,
  isTargetCaen,
  caenDescription,
  caenLabel,
  countyName,
  normalizeCaen,
  normalizeCounty,
} from "./caen";
export {
  parseFirmsFile,
  isActiveByState,
  parseFirmLine,
  detectParserConfig,
  detectDelimiter,
  mapColumnsByHeader,
  normalizePhone,
} from "./parse";
export { queryAnafBatch, ANAF_BATCH_SIZE } from "./anaf";
export type { AnafFirmInfo } from "./anaf";
export { streamImportFirms } from "./stream";
export type {
  StreamImportOptions,
  StreamImportResult,
  StreamDiagnostic,
} from "./stream";
export { splitDelimited } from "./parse";
export { aduFirmeLipsa, cuiCurat } from "./firma-lipsa";
export type { FirmaDeAdus, RezultatAducere } from "./firma-lipsa";
