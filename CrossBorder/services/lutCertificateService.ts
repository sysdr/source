/** @deprecated Use entityRegistryService — kept for backward compatibility */
export {
  getEntityRegistry as getLutRegistry,
  getLutForFinancialYear,
  getCurrentLutArn,
  currentIndianFinancialYear,
  formatRegisteredAddress,
  LUT_DECLARATION,
  type LutCertificate,
} from './entityRegistryService';

export type LutRegistry = import('./entityRegistryService').EntityRegistry;
