// @ts-nocheck
"use strict";
const axios = require("axios");
const qs = require("qs");

// URL BASE REAL
const API_BASE = "https://logistics.api.cabify.com/v1";

module.exports = {
  async testConnection() {
    try {
      const url = "https://cabify.com/auth/api/authorization";
      const data = {
        grant_type: "client_credentials",
        client_id: process.env.CABIFY_CLIENT_ID,
        client_secret: process.env.CABIFY_CLIENT_SECRET,
      };

      const response = await axios({
        method: "post",
        url: url,
        data: qs.stringify(data),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      return { success: true, token: response.data.access_token };
    } catch (err) {
      return { success: false, error: err.response?.data || err.message };
    }
  },

  // 1. OBTENER TIPOS DISPONIBLES (Para saber qué ID enviar)
  async getShippingTypes(lat, lng) {
    const auth = await this.testConnection();
    const response = await axios.get(
      `${API_BASE}/shipping_types/available?location=${lat},${lng}`,
      {
        headers: { Authorization: `Bearer ${auth.token}` },
      },
    );
    return response.data; // Aquí eliges el ID que corresponde a "Express"
  },

  // 2. CREAR PAQUETE CON TARIFA (Aquí es donde la API responde con el precio)
  async createShipment(parcelData) {
    const auth = await this.testConnection();

    // parcelData DEBE incluir: { shipping_type_id: "...", ... }
    const payload = { parcels: [parcelData] };

    try {
      const response = await axios.post(`${API_BASE}/parcels`, payload, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "application/json",
        },
      });
      // Esta respuesta DEBERÍA traer el precio final consolidado
      return response.data;
    } catch (error) {
      throw new Error(JSON.stringify(error.response?.data || error.message));
    }
  },
  async testMyParcel() {
    const parcelId = "9e35184b-7015-11f1-bcdf-ae4d1e293208";
    const auth = await this.testConnection();

    const response = await axios.get(
      `https://logistics.api.cabify.com/v1/parcels/${parcelId}`,
      {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          Accept: "application/json",
        },
      },
    );
    return response.data;
  },
  async getPriceEstimate(parcelData) {
    const auth = await this.testConnection();
    const lat = parcelData.pickup_location.lat;
    const lon = parcelData.pickup_location.lon;

    // 1. Llamada a tipos disponibles
    const typesResponse = await axios.get(
      `https://logistics.api.cabify.com/v1/shipping_types/available?location=${lat},${lon}`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );

    // DEBUG: Si no hay tipos, lanza el error con toda la respuesta para ver qué pasa
    if (
      !typesResponse.data ||
      !typesResponse.data.shipping_types ||
      typesResponse.data.shipping_types.length === 0
    ) {
      throw new Error(
        "No hay tipos de envío disponibles. Respuesta completa: " +
          JSON.stringify(typesResponse.data),
      );
    }

    const shippingTypeId = typesResponse.data.shipping_types[0].id;

    // 2. Ahora lanzamos la estimación con ese ID automático
    const payload = {
      shipping_type_id: shippingTypeId,
      deliveries: [
        {
          parcels: [parcelData],
        },
      ],
    };

    const response = await axios.post(
      `https://logistics.api.cabify.com/v3/parcels/estimate`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
    );

    return response.data;
  },
};
