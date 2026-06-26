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
    // 1. Obtener token ANTES de hacer nada
    const auth = await this.testConnection();
    if (!auth.success) throw new Error("Fallo en la autenticación con Cabify");

    // 2. Coordenadas fijas
    const KOKY_KITCHEN = { lat: 4.6976, lon: -74.0617 };

    // 3. Consultar servicios (usando el token obtenido)
    const typesResponse = await axios.get(
      `https://logistics.api.cabify.com/v1/shipping_types/available?location=${parcelData.dropoff_location.lat},${parcelData.dropoff_location.lon}`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );

    const shippingTypes = typesResponse.data.available_shipping_types;
    const expressType = shippingTypes.find(
      (t) =>
        t.modality === "express" && !t.name.toLowerCase().includes("comida"),
    );

    if (!expressType) {
      throw new Error("No hay servicios express disponibles en esta zona.");
    }

    // 4. Estimar (usando el token obtenido)
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
        pickup_time: new Date().toISOString(),
      },
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );

    return response.data;
  },
};
