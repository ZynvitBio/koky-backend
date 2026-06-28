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
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(now);
    const year = parts.find((p) => p.type === "year").value;
    const month = parts.find((p) => p.type === "month").value;
    const day = parts.find((p) => p.type === "day").value;

    const todayInColombia = new Date(`${year}-${month}-${day}T00:00:00-05:00`);
    const tomorrow830Colombia = new Date(
      todayInColombia.getTime() + 24 * 60 * 60 * 1000 + 8.5 * 60 * 60 * 1000
    );

    return tomorrow830Colombia.toISOString();
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
};

