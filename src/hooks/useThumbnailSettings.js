import { useState, useEffect } from 'react';

const STORAGE_KEY = 'thumbnail_settings_v1';

const defaultSettings = {
  hoverMode: false,
  showName: true,
  showSeries: true,
  showNumber: true,
  showRarity: true,
  showPrice: true,
};

export function useThumbnailSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...defaultSettings, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.warn('Failed to parse thumbnail settings from local storage', e);
    }
    return defaultSettings;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn('Failed to save thumbnail settings to local storage', e);
    }
  }, [settings]);

  const toggleSetting = (key) => {
    setSettings((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const updateSettings = (newSettings) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
  };

  return {
    settings,
    toggleSetting,
    updateSettings,
  };
}
