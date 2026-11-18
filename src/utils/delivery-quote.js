// @ts-nocheck
"use strict";

/**
 * Utilidad ÚNICA de tarifas de domicilio de Koky.
 * - Lista oficial de zonas: src/data/delivery-zones.json (la usan web, checkout WhatsApp y Kira).
 * - Cadena de precio: Cabify -> sector más cercano (por coordenadas) -> null (NUNCA un precio inventado).
 */

const axios = require("axios");
const ZONES_DATA = require("../data/delivery-zones.json");

const KITCHEN = { lat: 4.6976, lon: -74.0617 };
const BOUNDS = { south: 4.44, north: 4.95, west: -74.26, east: -73.98 };
// Distancia máxima (km) a un barrio conocido para usar su tarifa como respaldo
const MAX_NEAREST_KM = 4;
const QUOTE_CACHE_TTL_MS = 10 * 60 * 1000;
const quoteCache = new Map();

const ZONES = ZONES_DATA.zones;

// ---------- Helpers ----------
function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9#\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function roundUp500(value) {
  return Math.ceil(Number(value) / 500) * 500;
}

function formatCOP(value) {
  return `$${Number(value).toLocaleString("es-CO")}`;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function isInCoverage(lat, lon) {
  return lat >= BOUNDS.south && lat <= BOUNDS.north && lon >= BOUNDS.west && lon <= BOUNDS.east;
}

/** Coordenadas reales del cliente (no vacías, dentro de cobertura y no el placeholder de la cocina). */
function isRealCoords(lat, lon) {
  lat = Number(lat);
  lon = Number(lon);
  if (!lat || !lon || Number.isNaN(lat) || Number.isNaN(lon)) return false;
  if (!isInCoverage(lat, lon)) return false;
  if (Math.abs(lat - KITCHEN.lat) < 1e-6 && Math.abs(lon - KITCHEN.lon) < 1e-6) return false;
  return true;
}

function zoneCenter(zone) {
  const pts = zone.barrios.filter((b) => b.lat && b.lon);
  if (pts.length === 0) return null;
  return {
    lat: pts.reduce((s, b) => s + b.lat, 0) / pts.length,
    lon: pts.reduce((s, b) => s + b.lon, 0) / pts.length,
  };
}

// ---------- Localidades (agrupación de sectores) ----------
const LOCALIDADES = {};
for (const zone of ZONES) {
  for (const loc of [zone.localidad, ...(zone.localidadesExtra || [])]) {
    if (!LOCALIDADES[loc]) LOCALIDADES[loc] = { name: loc, zones: [] };
    LOCALIDADES[loc].zones.push(zone);
  }
}
for (const loc of Object.values(LOCALIDADES)) {
  const prices = loc.zones.map((z) => z.price);
  loc.minPrice = Math.min(...prices);
  loc.maxPrice = Math.max(...prices);
  // Precio aproximado de la localidad = PROMEDIO de sus sectores, redondeado hacia arriba a $500
  loc.avgPrice = roundUp500(prices.reduce((s, p) => s + p, 0) / prices.length);
}

// Alias adicionales de localidades/municipios (sin tildes)
const LOCALIDAD_ALIASES = {
  "Los Mártires": ["martires"],
  "Rafael Uribe Uribe": ["rafael uribe"],
  "La Candelaria": ["candelaria"],
  "La Calera": ["calera"],
  "Barrios Unidos": [],
  "Cota": [],
  "Chía": ["chia"],
};
const STRICT_LOCALIDADES = new Set(["Cota"]);

// ---------- Matchers de texto (barrios y localidades) ----------
const MATCHERS = [];
for (const zone of ZONES) {
  for (const b of zone.barrios) {
    if (b.match === false) continue;
    for (const name of [b.name, ...(b.aliases || [])]) {
      MATCHERS.push({ pattern: normalize(name), type: "barrio", zone, barrio: b.name, strict: !!b.strict });
    }
  }
}
for (const loc of Object.values(LOCALIDADES)) {
  const names = [loc.name, ...(LOCALIDAD_ALIASES[loc.name] || [])];
  for (const name of names) {
    MATCHERS.push({ pattern: normalize(name), type: "localidad", localidad: loc, strict: STRICT_LOCALIDADES.has(loc.name) });
  }
}
// Primero los más largos ("san cristobal norte" antes que "san cristobal")
MATCHERS.sort((a, b) => b.pattern.length - a.pattern.length);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Busca un barrio o localidad mencionado en el texto.
 * @returns {{type:'barrio', zone, barrio} | {type:'localidad', localidad} | null}
 */
function detectZoneMention(text) {
  const clean = normalize(text);
  if (!clean) return null;
  const wordCount = clean.split(" ").length;

  for (const m of MATCHERS) {
    const re = new RegExp(`(^|[^a-z0-9])${escapeRe(m.pattern)}([^a-z0-9]|$)`);
    if (!re.test(clean)) continue;
    if (m.strict) {
      const ctx = new RegExp(`(barrio|sector|vivo en|vivo por|queda en|estoy en|soy de|en el|en la|por el|por la)\\s+${escapeRe(m.pattern)}`);
      if (wordCount > 4 && !ctx.test(clean)) continue;
    }
    if (m.type === "barrio") return { type: "barrio", zone: m.zone, barrio: m.barrio };
    return { type: "localidad", localidad: m.localidad };
  }
  return null;
}

const VIA_RE = /\b(cl|cll|calle|cra|cr|kr|kra|carrera|ak|ac|av|avda|avenida|dg|diag|diagonal|tv|tr|transv|trans|transversal|autopista)\b\.?/i;

/** Si el texto contiene una dirección tipo "Calle 45 # 13-20", devuelve la porción de dirección. */
function detectAddress(text) {
  const raw = String(text || "");
  const m = raw.match(VIA_RE);
  if (!m) return null;
  const tail = raw.slice(m.index).slice(0, 140);
  const numbers = tail.match(/\d+/g) || [];
  if (numbers.length < 2) return null;
  return tail.trim();
}

// ---------- Google Geocoding ----------
async function geocodeAddress(address) {
  const apiKey = process.env.G_MAPS_BACKEND_KEY || process.env.G_MAPS_KEY;
  if (!apiKey) {
    throw new Error("Ni G_MAPS_BACKEND_KEY ni G_MAPS_KEY están configuradas.");
  }

  let queryAddress = address;
  const lower = address.toLowerCase();
  const hasCity = lower.includes("bogota") || lower.includes("bogotá") || lower.includes("chía") || lower.includes("chia") || lower.includes("cota") || lower.includes("cajica") || lower.includes("cajicá") || lower.includes("calera") || lower.includes("soacha");
  if (!hasCity) {
    queryAddress = `${address}, Bogotá, Colombia`;
  } else if (!lower.includes("colombia")) {
    queryAddress = `${address}, Colombia`;
  }

  const response = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
    params: {
      address: queryAddress,
      key: apiKey,
      bounds: `${BOUNDS.south},${BOUNDS.west}|${BOUNDS.north},${BOUNDS.east}`,
      region: "co",
    },
  });

  if (response.data.status === "ZERO_RESULTS") {
    return { success: false, reason: "NOT_FOUND" };
  }

  if (response.data.status !== "OK") {
    console.error(`❌ Google Maps API error (${response.data.status}): ${response.data.error_message || ""}`);
    return { success: false, reason: "API_ERROR" };
  }

  const result = response.data.results[0];
  // Si Google solo devolvió la ciudad/departamento/país (no encontró la dirección), NO es una ubicación válida:
  // usar el centro de Bogotá daría un precio de domicilio equivocado.
  const coarseTypes = ["locality", "political", "administrative_area_level_1", "administrative_area_level_2", "country", "colloquial_area"];
  if ((result.types || []).every((t) => coarseTypes.includes(t))) {
    return { success: false, reason: "TOO_GENERIC" };
  }

  const { lat, lng } = result.geometry.location;
  if (!isInCoverage(lat, lng)) {
    return { success: false, reason: "OUT_OF_COVERAGE", lat, lng, formattedAddress: result.formatted_address };
  }

  return { success: true, lat, lng, formattedAddress: result.formatted_address };
}

// ---------- Cabify ----------
const CABIFY_TIMEOUT_MS = 6000;

async function getCabifyPrice(lat, lon, { useCache = false } = {}) {
  const cacheKey = `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
  if (useCache) {
    const cached = quoteCache.get(cacheKey);
    if (cached && Date.now() - cached.at < QUOTE_CACHE_TTL_MS) return cached.amount;
  }
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Cabify timeout (${CABIFY_TIMEOUT_MS}ms)`)), CABIFY_TIMEOUT_MS)
    );
    const result = await Promise.race([
      strapi.service("api::cabify-delivery.cabify-delivery").getPriceEstimate({
        dropoff_location: { lat: Number(lat), lon: Number(lon) },
        dimensions: { height: 10, length: 10, width: 10, unit: "cm" },
        weight: { value: 1000, unit: "g" },
      }),
      timeoutPromise,
    ]);
    const amount = Number(result?.deliveries?.[0]?.estimation?.price?.amount);
    if (amount > 0) {
      quoteCache.set(cacheKey, { amount, at: Date.now() });
      return amount;
    }
    console.warn("⚠️ Cabify respondió sin precio de estimación.");
    return null;
  } catch (err) {
    console.error("❌ Error consultando Cabify:", err.message);
    return null;
  }
}

// ---------- Sector más cercano ----------
function findNearestZone(lat, lon) {
  if (!isRealCoords(lat, lon)) return null;
  let best = null;
  for (const zone of ZONES) {
    for (const b of zone.barrios) {
      if (!b.lat || !b.lon) continue;
      const km = haversineKm(Number(lat), Number(lon), b.lat, b.lon);
      if (!best || km < best.km) best = { zone, barrio: b.name, km };
    }
  }
  if (!best || best.km > MAX_NEAREST_KM) return null;
  return best;
}

/**
 * Precio REAL a cobrar en el checkout.
 * Orden: tarifa de sector elegido manualmente -> Cabify -> sector más cercano -> null.
 * Si devuelve null NO se debe crear el pedido (pedir al cliente su sector).
 */
async function resolveCheckoutDeliveryCost({ lat, lon, manualPrice } = {}) {
  if (Number(manualPrice) > 0) {
    return { cost: Number(manualPrice), source: "zone_manual" };
  }
  if (!isRealCoords(lat, lon)) {
    return null;
  }
  const cabify = await getCabifyPrice(lat, lon);
  if (cabify) {
    return { cost: cabify, source: "cabify" };
  }
  const nearest = findNearestZone(lat, lon);
  if (nearest) {
    console.warn(`⚠️ Cabify falló. Usando tarifa del sector más cercano: ${nearest.zone.label} (${nearest.km.toFixed(1)} km)`);
    return { cost: nearest.zone.price, source: "zone_nearest", zone: nearest.zone };
  }
  return null;
}

/** Cotización aproximada desde coordenadas (para el chat). */
async function quoteByCoords(lat, lon, label) {
  if (!isInCoverage(Number(lat), Number(lon))) {
    return { type: "out_of_coverage", label };
  }
  const cabify = await getCabifyPrice(lat, lon, { useCache: true });
  if (cabify) {
    return { type: "exact", price: roundUp500(cabify), source: "cabify", label, lat, lon };
  }
  const nearest = findNearestZone(lat, lon);
  if (nearest) {
    return { type: "exact", price: nearest.zone.price, source: "zone_nearest", label, zone: nearest.zone, lat, lon };
  }
  return { type: "unresolved", label };
}

/**
 * Cotización aproximada para Kira a partir del mensaje del cliente.
 * @param {string} text  Mensaje del cliente
 * @param {{lat:number, lon:number, name?:string, address?:string}} [location] Ubicación compartida por WhatsApp
 * @returns {Promise<object|null>} null si el mensaje no menciona ubicación
 */
async function quoteForChat(text, location) {
  if (location && location.lat && location.lon) {
    const label = location.address || location.name || "la ubicación que compartió";
    return quoteByCoords(location.lat, location.lon, label);
  }

  const address = detectAddress(text);
  if (address) {
    try {
      const geo = await geocodeAddress(address);
      if (geo.success) {
        const coordsQuote = await quoteByCoords(geo.lat, geo.lng, address);
        if (coordsQuote.type !== "unresolved") return coordsQuote;
        // Cabify y zona_nearest fallaron: intentar con el barrio que Google incluye en la dirección formateada
        // (ej: "Calle 97 #21-62, Chico, Bogotá..." → detecta "Chico" → precio de zona)
        if (geo.formattedAddress) {
          const fmtMention = detectZoneMention(geo.formattedAddress);
          if (fmtMention) {
            console.log(`📍 Precio obtenido del barrio en formattedAddress: "${geo.formattedAddress}"`);
            return quoteFromMention(fmtMention);
          }
        }
        return coordsQuote; // unresolved
      }
      if (geo.reason === "OUT_OF_COVERAGE") {
        return { type: "out_of_coverage", label: address };
      }
    } catch (err) {
      console.error("❌ Error geocodificando dirección para cotización:", err.message);
    }
    // Geocodeo falló: intentar con barrio/localidad mencionados en el texto
    const mention = detectZoneMention(text);
    if (mention) return quoteFromMention(mention);
    return { type: "unresolved", label: address };
  }

  const mention = detectZoneMention(text);
  if (mention) return quoteFromMention(mention);
  return null;
}

function quoteFromMention(mention) {
  if (mention.type === "barrio") {
    return { type: "barrio", price: mention.zone.price, label: mention.barrio, zone: mention.zone, source: "zone_list" };
  }
  const loc = mention.localidad;
  if (loc.zones.length === 1) {
    return { type: "barrio", price: loc.zones[0].price, label: loc.name, zone: loc.zones[0], source: "zone_list" };
  }
  return {
    type: "localidad",
    price: loc.avgPrice,
    label: loc.name,
    minPrice: loc.minPrice,
    maxPrice: loc.maxPrice,
    source: "zone_list",
  };
}

/** Texto para inyectar en el prompt de Kira. */
function buildQuotePromptText(quote, deliveryFormatted) {
  if (!quote) return "";
  const when = deliveryFormatted ? ` para la entrega del ${deliveryFormatted}` : "";
  switch (quote.type) {
    case "exact":
      return `- El cliente dio su dirección/ubicación (${quote.label}). DOMICILIO APROXIMADO: ${formatCOP(quote.price)}${when}. Dilo de inmediato con "aprox." (la tarifa es dinámica y puede variar un poco).`;
    case "barrio":
      return `- El cliente mencionó "${quote.label}" (sector ${quote.zone.label}). DOMICILIO APROXIMADO: ${formatCOP(quote.price)}. Dilo de inmediato con "aprox.". Si quiere el valor exacto, puede pasarte la dirección (opcional).`;
    case "localidad":
      return `- El cliente solo mencionó la localidad "${quote.label}". DOMICILIO APROXIMADO: ${formatCOP(quote.price)} (promedio de la localidad). Da UN SOLO precio: "alrededor de ${formatCOP(quote.price)} aprox.". Ofrece, sin exigirlo, afinarlo si te dice el barrio o la dirección. NO listes barrios.`;
    case "out_of_coverage":
      return `- La dirección/ubicación del cliente (${quote.label}) está FUERA de nuestra zona de cobertura (solo cubrimos Bogotá y Chía). Díselo con amabilidad.`;
    case "unresolved":
      return `- El cliente dio una dirección (${quote.label}) pero no se pudo calcular el precio exacto de envío. Si en el historial del chat ya conoces su barrio o localidad, úsalo para dar el precio aproximado. Si no tienes ese dato, pídele el barrio amablemente. NO inventes un precio.`;
    default:
      return "";
  }
}

// ---------- Listado de sectores para que el cliente elija (checkout WhatsApp) ----------
function getSectorList() {
  return ZONES.map((z, i) => ({ number: i + 1, zone: z }));
}

function buildSectorListMessage(intro, onlyZones) {
  const items = getSectorList().filter((it) => !onlyZones || onlyZones.includes(it.zone));
  let msg = `${intro}\n`;
  let currentLoc = null;
  for (const it of items) {
    const locTitle = it.zone.municipio ? "Municipios cercanos" : it.zone.localidad;
    if (locTitle !== currentLoc) {
      msg += `\n*${locTitle}*\n`;
      currentLoc = locTitle;
    }
    const barrios = it.zone.label.split(" - ").slice(1).join(" - ") || it.zone.label;
    const prefix = it.zone.municipio ? `${it.zone.label.split(" - ")[0]}: ` : "";
    msg += `${it.number}. ${prefix}${barrios}\n`;
  }
  msg += `\nResponde con el *número* de tu sector (o escribe tu barrio).`;
  return msg;
}

/**
 * Interpreta la respuesta del cliente al listado de sectores.
 * @returns {{zone} | {ambiguous: zone[]} | null}
 */
function parseSectorReply(text) {
  const clean = normalize(text);
  const num = parseInt(clean, 10);
  if (/^\d+$/.test(clean) && num >= 1 && num <= ZONES.length) {
    return { zone: ZONES[num - 1] };
  }
  const mention = detectZoneMention(text);
  if (!mention) return null;
  if (mention.type === "barrio") return { zone: mention.zone };
  if (mention.localidad.zones.length === 1) return { zone: mention.localidad.zones[0] };
  return { ambiguous: mention.localidad.zones };
}

/** Datos públicos para la web. */
function getPublicZones() {
  return ZONES.map((z) => ({ id: z.id, label: z.label, localidad: z.localidad, price: z.price, municipio: !!z.municipio }));
}

module.exports = {
  KITCHEN,
  BOUNDS,
  ZONES,
  LOCALIDADES,
  normalize,
  roundUp500,
  formatCOP,
  isRealCoords,
  zoneCenter,
  detectZoneMention,
  detectAddress,
  geocodeAddress,
  getCabifyPrice,
  findNearestZone,
  resolveCheckoutDeliveryCost,
  quoteForChat,
  quoteByCoords,
  buildQuotePromptText,
  buildSectorListMessage,
  parseSectorReply,
  getPublicZones,
};
