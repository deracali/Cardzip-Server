import { readFeatureSettings } from '../controller/featureSettingsController.js';

const featureLabels = {
  esimEnabled: 'eSIM and virtual-number services',
  vtpassBillsEnabled: 'VTPass bill payments',
};

export default function requireFeatureEnabled(feature) {
  return async (req, res, next) => {
    try {
      const settings = await readFeatureSettings();
      if (!settings[feature]) {
        return res.status(503).json({
          success: false,
          message: `${featureLabels[feature] || 'This service'} are temporarily unavailable.`,
        });
      }
      return next();
    } catch (error) {
      console.error(`Could not check ${feature} availability:`, error);
      return res.status(500).json({ success: false, message: 'Could not check service availability.' });
    }
  };
}
