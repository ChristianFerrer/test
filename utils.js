// ============================================================
// utils.js - Shared utilities for Whistle App
// ============================================================

// --- SUPABASE CONFIG ---
// Replace with your actual Supabase project values
const SUPABASE_URL = 'https://gboguglxgvdsvzprtigj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdib2d1Z2x4Z3Zkc3Z6cHJ0aWdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0NDk4NDksImV4cCI6MjA4NzAyNTg0OX0.f1NcwM2D29kD3x-rFxiWH1kK6ME4SD294UxNygGE8-E';

// --- CONSTANTS ---
const ALERT_RADIUS_M  = 100;  // meters - live map nearby radius
const ALERT_AGE_MIN   = 20;   // minutes - max age for live map alerts
const HISTORY_RADIUS_M = 5000; // meters - history screen radius (5 km)
const COOLDOWN_MS     = 30000; // milliseconds - cooldown between alerts

// --- CLUSTERING (alert validation) ---
const CLUSTER_RADIUS_M  = 100; // meters  - radius to group alerts as same incident
const CLUSTER_MIN_USERS = 2;   // distinct users needed to mark an alert as verified
const CLUSTER_TIME_MIN  = 10;  // minutes - time window for clustering

// --- HEATMAP ---
const HEATMAP_DAYS     = 30;   // days of historical data for risk heatmap
const HEATMAP_RADIUS_M = 10000; // 10 km around user for heatmap query
const OSM_POI_WEIGHT   = 0.2;  // weight of OSM POI baseline points (real alerts are 0.1–1.0)

// --- SURGE DETECTION ---
const SURGE_WINDOW_MIN = 30;   // compare alerts in last N min vs historical average
const SURGE_THRESHOLD  = 3;    // rate must be ≥ 3× historical average to flag as surge
const SURGE_MIN_COUNT  = 2;    // need at least N alerts to consider a surge (avoid noise)

// --- ZONE INSIGHTS ---
const ZONE_INSIGHT_DAYS  = 30; // days of history for safety score & peak hours
const ZONE_SCORE_WEIGHT  = 15; // score penalty per recent (recency-weighted) alert
const ZONE_PEAK_MIN_DATA = 3;  // min alerts needed before showing peak hour


// --- USER IDENTITY ---
// Persistent anonymous device ID (no account needed)
function getOrCreateUserId() {
  let id = localStorage.getItem('whistle_user_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('whistle_user_id', id);
  }
  return id;
}

// --- GEOSPATIAL UTILITIES ---

/**
 * Haversine formula - great-circle distance in meters between two lat/lng points.
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Returns a lat/lng bounding box for a given center and radius.
 * Used as a cheap pre-filter for Supabase queries before precise Haversine check.
 */
function getBoundingBox(lat, lng, radiusMeters) {
  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

// --- TIME UTILITIES ---

/**
 * Human-readable relative time string from an ISO timestamp.
 */
function formatTimeAgo(isoString) {
  const mins = Math.floor((Date.now() - new Date(isoString)) / 60000);
  const _t = window.t || (k => k);
  if (mins < 1) return _t('time.now');
  if (mins < 60) return _t('time.mins_ago', { n: mins });
  const hrs = Math.floor(mins / 60);
  return _t('time.hours_ago', { n: hrs });
}

/**
 * ISO string for the start of today (local midnight) in UTC.
 */
function getTodayStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

// --- TOAST NOTIFICATION ---
function showToast(message, durationMs = 3000) {
  // Remove any existing toast
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('visible'));
  });

  if (durationMs > 0) {
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, durationMs);
  }

  return toast;
}

function hideToast(toast) {
  if (!toast || !toast.parentNode) return;
  toast.classList.remove('visible');
  setTimeout(() => toast.remove(), 300);
}

// --- HAPTIC FEEDBACK ---
function vibrate(pattern) {
  if ('vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

// --- SHARE ---
/**
 * Share Whistle via native share sheet (WhatsApp, Telegram, Messages, etc).
 * Falls back to copying the link to clipboard if Web Share API is unavailable.
 * @param {string} text - Pre-filled share text (without URL)
 * @param {string} title - Share title (shown in some apps)
 */
async function shareWhistle(text, title = 'Whistle') {
  const url = (typeof location !== 'undefined' && location.origin)
    ? location.origin + '/landing.html'
    : 'https://whistle.app';
  const fullText = text + ' ' + url;
  const _t = window.t || (k => k);

  // Native share sheet (iOS, Android, modern desktop)
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      vibrate(10);
      return true;
    } catch (err) {
      // User cancelled — not an error, do nothing
      if (err && err.name === 'AbortError') return false;
      // Fall through to clipboard fallback
    }
  }

  // Fallback: copy to clipboard
  try {
    await navigator.clipboard.writeText(fullText);
    showToast(_t('share.copied'));
    vibrate(10);
    return true;
  } catch {
    // Last resort: execCommand
    const ta = document.createElement('textarea');
    ta.value = fullText;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
    showToast(_t('share.copied'));
    return true;
  }
}
