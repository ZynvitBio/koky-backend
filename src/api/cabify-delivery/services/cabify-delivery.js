// @ts-nocheck
"use strict";
const axios = require("axios");
const qs = require("qs");

const API_BASE = "https://logistics.api.cabify.com/v1";

module.exports = {
  /**
   * Obtiene un token de acceso válido de Cabify.
   */
  async getAuthToken() {
    try {
      const url = "https://cabify.com/auth/api/authorization";
      const data = {
        grant_type: "client_credentials",
        client_id: process.env.CABIFY_CLIENT_ID,
        client_secret: process.env.CABIFY_CLIENT_SECRET,
      };

      const response = await axios.post(url, qs.stringify(data), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      return response.data.access_token;
    } catch (err) {
      throw new Error(
        "Fallo en la autenticación con Cabify: " +
          (err.response?.data?.message || err.message),
      );
    }
  },

  /**
   * Calcula la fecha del día siguiente a las 8:30 AM en la zona horaria America/Bogota (UTC-5)
   * y la retorna en formato ISO 8601 UTC.
   */
  getTomorrowMorningISO() {
    const deliveryDateStr = calculateDeliveryDate(new Date());
    const scheduledTime = new Date(`${deliveryDateStr}T15:00:00-05:00`);
    return scheduledTime.toISOString();
  },

  /**
   * Paso 1 (Flujo A): Obtener estimación de precio.
   */
  async getPriceEstimate(parcelData) {
    const token = await this.getAuthToken();
    const KOKY_KITCHEN = { lat: 4.6976, lon: -74.0617 };

    // Obtener tipos de servicio disponibles
    const typesResponse = await axios.get(
      `${API_BASE}/shipping_types/available?location=${parcelData.dropoff_location.lat},${parcelData.dropoff_location.lon}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const expressType = typesResponse.data.available_shipping_types.find(
      (t) =>
        t.modality === "express" && !t.name.toLowerCase().includes("comida"),
    );

    if (!expressType) throw new Error("No hay servicios express disponibles.");

    const scheduledPickupTime = this.getTomorrowMorningISO();

    // Solicitar estimación
    const response = await axios.post(
      `https://logistics.api.cabify.com/v3/parcels/estimate`,
      {
        parcels: [
          {
            external_id: "KOKY_" + Date.now(),
            pickup_location: KOKY_KITCHEN,
            dropoff_location: parcelData.dropoff_location,
            dimensions: parcelData.dimensions,
            weight: parcelData.weight,
          },
        ],
        shipping_type_id: expressType.id,
        pickup_time: scheduledPickupTime,
      },
      { headers: { Authorization: `Bearer ${token}` } },
    );

    return response.data;
  },

  /**
   * Paso 2 (Flujo B): Crear paquete y programar el envío.
   */
  async createAndDeliverParcel(deliveryData) {
    const token = await this.getAuthToken();
    const KOKY_KITCHEN = { lat: 4.6976, lon: -74.0617 };

    // 1. Obtener tipos de servicio disponibles
    const typesResponse = await axios.get(
      `${API_BASE}/shipping_types/available?location=${deliveryData.dropoff_location.lat},${deliveryData.dropoff_location.lon}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const expressType = typesResponse.data.available_shipping_types.find(
      (t) =>
        t.modality === "express" && !t.name.toLowerCase().includes("comida"),
    );

    if (!expressType) throw new Error("No hay servicios express disponibles.");

    const scheduledPickupTime = this.getTomorrowMorningISO();

    // 2. Crear el paquete (POST /parcels)
    const createResponse = await axios.post(
      `${API_BASE}/parcels`,
      {
        parcels: [
          {
            external_id: deliveryData.external_id || ("KOKY_" + Date.now()),
            pickup_info: {
              addr: "Calle 119a # 57-40, Bogotá", // Dirección física de Koky Kitchen
              contact: {
                name: "Koky Kitchen",
                phone: "+573019447660",
              },
              instr: "Recoger en recepción de Koky Kitchen",
              loc: KOKY_KITCHEN,
            },
            dropoff_info: {
              addr: deliveryData.dropoff_address,
              contact: {
                name: deliveryData.customer_name,
                phone: deliveryData.customer_phone,
              },
              instr: deliveryData.notes || "",
              loc: {
                lat: deliveryData.dropoff_location.lat,
                lon: deliveryData.dropoff_location.lon,
              },
            },
            dimensions: { height: 10, length: 10, width: 10, unit: "cm" },
            weight: { value: 1000, unit: "g" },
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    const createdParcel = createResponse.data.parcels[0];
    const parcelId = createdParcel.id;

    // 3. Solicitar el envío (POST /parcels/ship)
    await axios.post(
      `${API_BASE}/parcels/ship`,
      {
        parcel_ids: [parcelId],
        shipping_type_id: expressType.id,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    return {
      success: true,
      parcelId: parcelId,
      externalId: createdParcel.external_id,
      pickup_time: scheduledPickupTime,
    };
  },

  /**
   * Paso 3: Cancelar la entrega de un paquete en Cabify.
   */
  async cancelParcel(parcelId) {
    const token = await this.getAuthToken();
    try {
      const response = await axios.post(
        `${API_BASE}/parcels/deliver/cancel`,
        {
          parcel_ids: [parcelId],
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      return response.data;
    } catch (err) {
      const errorDetails = err.response?.data
        ? JSON.stringify(err.response.data)
        : "";
      throw new Error(
        `Error de API Cabify al cancelar envío: ${err.message}. Detalles: ${errorDetails}`
      );
    }
  },

  async getParcelStatus(parcelId) {
    const token = await this.getAuthToken();
    try {
      const response = await axios.get(
        `${API_BASE}/parcels/${parcelId}/status`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      return response.data;
    } catch (err) {
      const errorDetails = err.response?.data
        ? JSON.stringify(err.response.data)
        : "";
      throw new Error(
        `Error de API Cabify al consultar estado: ${err.message}. Detalles: ${errorDetails}`
      );
    }
  },

  async registerWebhook(callbackUrl) {
    const token = await this.getAuthToken();
    try {
      const response = await axios.post(
        `${API_BASE}/webhooks`,
        {
          hook: "parcel",
          callback_url: callbackUrl,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      return response.data;
    } catch (err) {
      const errorDetails = err.response?.data
        ? JSON.stringify(err.response.data)
        : "";
      throw new Error(
        `Error de API Cabify al registrar webhook: ${err.message}. Detalles: ${errorDetails}`
      );
};

function calculateDeliveryDate(createdAtDate) {
  // Convertir a la hora de Bogotá para asegurar consistencia
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(new Date(createdAtDate));
  const year = parseInt(parts.find(p => p.type === 'year').value);
  const month = parseInt(parts.find(p => p.type === 'month').value) - 1;
  const day = parseInt(parts.find(p => p.type === 'day').value);
  const hour = parseInt(parts.find(p => p.type === 'hour').value);

  const bogotaDate = new Date(year, month, day, hour);
  const dayOfWeek = bogotaDate.getDay(); // 0 = Dom, 1 = Lun, ...

  const isHoliday = (dateToCheck) => {
    const y = dateToCheck.getFullYear();
    const holidays = getColombianHolidays(y);
    const m = String(dateToCheck.getMonth() + 1).padStart(2, '0');
    const d = String(dateToCheck.getDate()).padStart(2, '0');
    return holidays.has(`${y}-${m}-${d}`);
  };

  const isWeekend = (dateToCheck) => {
    const d = dateToCheck.getDay();
    return d === 0 || d === 6;
  };

  let targetDate = new Date(bogotaDate);

  // Determinamos la ventana del fin de semana largo (Jueves 4:00 PM al Domingo 4:00 PM)
  const isWeekendWindow = 
    (dayOfWeek === 4 && hour >= 16) || // Jueves después de las 4 PM
    (dayOfWeek === 5) ||               // Viernes todo el día
    (dayOfWeek === 6) ||               // Sábado todo el día
    (dayOfWeek === 0 && hour < 16);    // Domingo antes de las 4 PM

  if (isWeekendWindow) {
    // Pedidos en ventana de fin de semana se entregan el lunes inicialmente
    const daysToAdd = dayOfWeek === 4 ? 4 : (dayOfWeek === 5 ? 3 : (dayOfWeek === 6 ? 2 : 1));
    targetDate.setDate(bogotaDate.getDate() + daysToAdd);
  } else if (dayOfWeek === 0 && hour >= 16) {
    // Domingo después de las 4:00 PM se entrega el martes inicialmente
    targetDate.setDate(bogotaDate.getDate() + 2);
  } else {
    // Caso estándar de lunes a jueves
    if (hour < 16) {
      targetDate.setDate(bogotaDate.getDate() + 1); // Entrega mañana
    } else {
      targetDate.setDate(bogotaDate.getDate() + 2); // Entrega pasado mañana
    }
  }

  // Bucle para saltar fines de semana y festivos
  while (isWeekend(targetDate) || isHoliday(targetDate)) {
    targetDate.setDate(targetDate.getDate() + 1);
  }

  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getColombianHolidays(year) {
  const holidays = new Set();

  // 1. Festivos Fijos (No se trasladan)
  holidays.add(`${year}-01-01`); // Año Nuevo
  holidays.add(`${year}-05-01`); // Día del Trabajo
  holidays.add(`${year}-07-20`); // Independencia
  holidays.add(`${year}-08-07`); // Batalla de Boyacá
  holidays.add(`${year}-12-08`); // Inmaculada Concepción
  holidays.add(`${year}-12-25`); // Navidad

  // Helper para mover al siguiente lunes (Ley Emiliani)
  const getNextMondayStr = (month, day) => {
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay(); // 0 = Dom, 1 = Lun, ...
    if (dayOfWeek === 1) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    const daysToAdd = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    date.setDate(date.getDate() + daysToAdd);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // 2. Festivos con fecha fija pero que se mueven al siguiente lunes
  holidays.add(getNextMondayStr(1, 6));   // Reyes Magos (6 Ene)
  holidays.add(getNextMondayStr(3, 19));  // San José (19 Mar)
  holidays.add(getNextMondayStr(6, 29));  // San Pedro y San Pablo (29 Jun)
  holidays.add(getNextMondayStr(7, 9));   // Virgen de Chiquinquirá (9 Jul - Nuevo Festivo Ley 2578)
  holidays.add(getNextMondayStr(8, 15));  // Asunción de la Virgen (15 Ago)
  holidays.add(getNextMondayStr(10, 12)); // Día de la Raza (12 Oct)
  holidays.add(getNextMondayStr(11, 1));  // Todos los Santos (1 Nov)
  holidays.add(getNextMondayStr(11, 11)); // Independencia de Cartagena (11 Nov)

  // 3. Festivos basados en la Pascua (Algoritmo Butcher-Oudin para el Domingo de Resurrección)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const L = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * L) / 451);
  const month = Math.floor((h + L - 7 * m + 114) / 31);
  const day = ((h + L - 7 * m + 114) % 31) + 1;
  
  const easter = new Date(year, month - 1, day);

  const addDaysStr = (baseDate, days) => {
    const date = new Date(baseDate);
    date.setDate(baseDate.getDate() + days);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  holidays.add(addDaysStr(easter, -3)); // Jueves Santo
  holidays.add(addDaysStr(easter, -2)); // Viernes Santo
  holidays.add(addDaysStr(easter, 43)); // Ascensión
  holidays.add(addDaysStr(easter, 64)); // Corpus Christi
  holidays.add(addDaysStr(easter, 71)); // Sagrado Corazón

  return holidays;
}


