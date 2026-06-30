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
};


