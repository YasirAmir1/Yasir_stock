import React, { useState, useEffect } from 'react';
import { Sun, Cloud, CloudRain, Wind, CloudLightning, RefreshCw } from 'lucide-react';

interface WeatherData {
  temperature: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  description: string;
  isDay: boolean;
}

interface WeatherWidgetProps {
  isDarkMode: boolean;
  compact?: boolean;
}

export const WeatherWidget: React.FC<WeatherWidgetProps> = ({ isDarkMode, compact = false }) => {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const fetchWeather = async () => {
    if (!navigator.onLine) {
      setWeather({
        temperature: 32,
        humidity: 35,
        windSpeed: 12,
        weatherCode: 0,
        description: 'مشمس',
        isDay: true,
      });
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(
        'https://api.open-meteo.com/v1/forecast?latitude=34.6064&longitude=43.6789&current=temperature_2m,relative_humidity_2m,is_day,weather_code,wind_speed_10m&timezone=Asia%2FBaghdad',
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error('Failed to fetch weather');
      const data = await res.json();
      const current = data.current;

      setWeather({
        temperature: Math.round(current.temperature_2m),
        humidity: current.relative_humidity_2m,
        windSpeed: current.wind_speed_10m,
        weatherCode: current.weather_code,
        description: getWeatherDescription(current.weather_code),
        isDay: current.is_day === 1,
      });
    } catch {
      // Graceful silent fallback without spamming console
      setWeather({
        temperature: 32,
        humidity: 35,
        windSpeed: 12,
        weatherCode: 0,
        description: 'مشمس',
        isDay: true,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWeather();
    const interval = setInterval(fetchWeather, 30 * 60 * 1000); // every 30 mins
    return () => clearInterval(interval);
  }, []);

  // WMO Weather interpretation codes (Open-Meteo)
  function getWeatherDescription(code: number): string {
    switch (code) {
      case 0: return 'صافٍ';
      case 1:
      case 2:
      case 3: return 'غائم جزئياً';
      case 45:
      case 48: return 'ضباب';
      case 51:
      case 53:
      case 55:
      case 56:
      case 57: return 'رذاذ خفيف';
      case 61:
      case 63:
      case 65:
      case 66:
      case 67: return 'أمطار';
      case 71:
      case 73:
      case 75:
      case 77: return 'ثلوج';
      case 80:
      case 81:
      case 82: return 'زخات مطر';
      case 95:
      case 96:
      case 99: return 'عواصف رعدية';
      default: return 'مشمس';
    }
  }

  const getWeatherIcon = (code: number, className: string = "w-4 h-4") => {
    if (code === 0) return <Sun className={`${className} text-amber-500`} />;
    if (code >= 51 && code <= 82) return <CloudRain className={`${className} text-blue-400`} />;
    if (code >= 95) return <CloudLightning className={`${className} text-purple-400`} />;
    if (code >= 45 && code <= 48) return <Wind className={`${className} text-slate-400`} />;
    return <Cloud className={`${className} text-sky-400`} />;
  };

  // Compact layout (used beside the delegate name on mobile)
  if (compact) {
    return (
      <div className="flex items-center gap-1 shrink-0 select-none">
        {/* Real-time Visual Connection Status Indicator (مؤشر حالة اتصال بصري لحظي) */}
        <div
          className={`flex items-center justify-center gap-1 px-1.5 py-1 rounded-xl border transition-all shadow-sm ${
            isDarkMode
              ? 'bg-slate-800/90 border-slate-700 text-slate-200'
              : 'bg-white/95 border-emerald-200 text-slate-800'
          }`}
          title={isOnline ? 'مؤشر اتصال لحظي: متصل بالإنترنت' : 'مؤشر اتصال لحظي: غير متصل بالإنترنت'}
        >
          <div className="relative flex items-center justify-center">
            <span className={`absolute inline-flex h-2.5 w-2.5 rounded-full opacity-75 animate-ping ${isOnline ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
            <span className={`relative inline-flex rounded-full h-2 w-2 ${isOnline ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
          </div>
          <span className={`text-[8px] font-black leading-none ${
            isOnline 
              ? (isDarkMode ? 'text-emerald-400' : 'text-emerald-700') 
              : (isDarkMode ? 'text-rose-400' : 'text-rose-600')
          }`}>
            {isOnline ? 'متصل' : 'انقطاع'}
          </span>
        </div>

        {/* Weather Widget (الطقس) */}
        <div
          className={`weather-widget flex items-center justify-center gap-1 px-1.5 py-1 rounded-xl border font-black text-[9px] transition-all shadow-sm ${
            isDarkMode
              ? 'bg-slate-800/90 text-sky-300 border-slate-700'
              : 'bg-sky-50/95 text-sky-950 border-sky-200'
          }`}
          title={`حالة الطقس في تكريت: ${weather ? weather.description : '...'}`}
        >
          {loading && !weather ? (
            <RefreshCw className="w-3 h-3 animate-spin text-sky-500" />
          ) : (
            weather && getWeatherIcon(weather.weatherCode, "w-3 h-3")
          )}
          <span className="text-[9px] font-black leading-none" style={{ direction: 'ltr' }}>
            {weather ? `${weather.temperature}°` : '..'}
          </span>
        </div>
      </div>
    );
  }

  // Standard Desktop layout
  return (
    <div className="header-container flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
      {/* Weather Widget */}
      <div
        className={`weather-widget p-1 sm:px-2.5 sm:py-1.5 rounded-xl border font-black text-[10px] sm:text-xs flex flex-col items-center justify-center gap-0.5 transition-all shadow-sm min-w-[45px] sm:min-w-[60px] ${
          isDarkMode
            ? 'bg-slate-800 text-sky-300 border-slate-700'
            : 'bg-sky-50 text-sky-950 border-sky-200'
        }`}
        title="حالة الطقس في تكريت"
      >
        <div className="flex items-center gap-1">
          {loading && !weather ? (
            <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin text-sky-500" />
          ) : (
            weather && getWeatherIcon(weather.weatherCode, "w-3.5 h-3.5 sm:w-4 sm:h-4")
          )}
          <span className="text-[10px] sm:text-xs font-bold">
            {weather ? `${weather.temperature}°C` : '...'}
          </span>
        </div>
        <span className="text-[7px] sm:text-[10px] leading-tight opacity-95 truncate max-w-[50px] sm:max-w-[70px] hidden sm:block">
          {weather ? weather.description : 'تكريت'}
        </span>
      </div>

      {/* Connection Status Indicator Box */}
      <div
        className={`flex flex-col items-center justify-center px-1.5 py-1 sm:px-2 sm:py-1.5 rounded-xl border transition-all shadow-sm min-w-[36px] sm:min-w-[50px] ${
          isDarkMode
            ? 'bg-slate-800 border-slate-700'
            : 'bg-white border-slate-200'
        }`}
        title={isOnline ? 'متصل بالإنترنت' : 'غير متصل بالإنترنت'}
      >
        <span className={`text-[7px] sm:text-[9px] font-extrabold leading-tight mb-0.5 px-1 py-0.5 rounded hidden sm:block ${
          isOnline
            ? (isDarkMode ? 'bg-emerald-950/80 text-emerald-400' : 'bg-emerald-100 text-emerald-800')
            : (isDarkMode ? 'bg-rose-950/80 text-rose-400' : 'bg-rose-100 text-rose-800')
        }`}>
          {isOnline ? 'متصل' : 'غير متصل'}
        </span>
        <div className="relative flex items-center justify-center my-0.5">
          <span className={`absolute inline-flex h-2.5 w-2.5 rounded-full opacity-75 animate-ping ${isOnline ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
          <span className={`relative inline-flex rounded-full h-2 w-2 ${isOnline ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
        </div>
      </div>
    </div>
  );
};
