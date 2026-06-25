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

    // 1. Obtener tipos de envío
    const typesResponse = await axios.get(
      `https://logistics.api.cabify.com/v1/shipping_types/available?location=${parcelData.pickup_location.lat},${parcelData.pickup_location.lon}`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );

    const shippingTypes = typesResponse.data.available_shipping_types;

    // FILTRO ESTRICTO: Buscamos el ID que sea modalidad 'express'
    const expressType = shippingTypes
      ? shippingTypes.find((t) => t.modality === "express")
      : null;

    if (!expressType) {
      throw new Error(
        "No se encontró tipo 'express'. IDs disponibles: " +
          JSON.stringify(shippingTypes),
      );
    }

    // 2. FORZAR DESTINO A 1KM DE DISTANCIA (aprox. 0.01 grados de latitud)
    const pickup = { lat: 4.7053, lon: -74.0688 };
    const dropoff = { lat: 4.7153, lon: -74.0788 };

    const payload = {
      parcels: [
        {
          external_id: "parcel_" + Date.now(),
          pickup_location: pickup,
          dropoff_location: dropoff,
          dimensions: { height: 20, length: 20, width: 20, unit: "cm" },
          weight: { value: 2000, unit: "g" },
        },
      ],
      shipping_type_id: expressType.id, // Asegúrate de que este ID sea el de "Express"
      pickup_time: new Date().toISOString(),
    };

    console.log(
      "PAYLOAD FINAL (Express ID: " + expressType.id + "):",
      JSON.stringify(payload),
    );

    // 3. Ejecutar estimación
    try {
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
    } catch (error) {
      const detailedError = error.response
        ? JSON.stringify(error.response.data)
        : error.message;
      throw new Error("Error de Cabify: " + detailedError);
    }
  },
};
