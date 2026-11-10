import FeatureSettings from '../model/featureSettingsModel.js';

const defaultSettings = {
  esimEnabled: true,
  vtpassBillsEnabled: true,
};

export const readFeatureSettings = async () => {
  const settings = await FeatureSettings.findById('global').lean();
  return {
    esimEnabled: settings?.esimEnabled ?? defaultSettings.esimEnabled,
    vtpassBillsEnabled: settings?.vtpassBillsEnabled ?? defaultSettings.vtpassBillsEnabled,
  };
};

export const getPublicFeatureSettings = async (req, res) => {
  try {
    res.json({ success: true, data: await readFeatureSettings() });
  } catch (error) {
    console.error('Could not load feature settings:', error);
    res.status(500).json({ success: false, message: 'Could not load service availability.' });
  }
};

export const getAdminFeatureSettings = getPublicFeatureSettings;

export const updateFeatureSettings = async (req, res) => {
  const { esimEnabled, vtpassBillsEnabled } = req.body || {};
  if (typeof esimEnabled !== 'boolean' || typeof vtpassBillsEnabled !== 'boolean') {
    return res.status(400).json({
      success: false,
      message: 'Both eSIM and VTPass bill availability values must be provided.',
    });
  }

  try {
    const settings = await FeatureSettings.findByIdAndUpdate(
      'global',
      { $set: { esimEnabled, vtpassBillsEnabled } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).lean();
    return res.json({
      success: true,
      data: {
        esimEnabled: settings.esimEnabled,
        vtpassBillsEnabled: settings.vtpassBillsEnabled,
      },
    });
  } catch (error) {
    console.error('Could not update feature settings:', error);
    return res.status(500).json({ success: false, message: 'Could not update service availability.' });
  }
};
