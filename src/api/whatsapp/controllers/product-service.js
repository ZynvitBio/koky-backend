// @ts-nocheck
'use strict';

module.exports = {
  async getProductsContext() {
    try {
      // Consultamos Strapi buscando productos activos
      const products = await strapi.entityService.findMany('api::product.product', {
        filters: { active: true },
        fields: [
          'name', 
          'price', 
          'shortDescription', 
          'unitMeasure', 
          'contentPerUnit', 
          'unitAbbreviation'
        ],
      });

      if (!products || products.length === 0) {
        return "Actualmente estamos preparando nuevos productos artesanales de soya.";
      }

      // Creamos la lista formateada para el cerebro de Kira
      const context = products.map(p => {
        return `- ${p.name}: $${p.price} (Presentación: ${p.contentPerUnit}${p.unitAbbreviation}). ${p.shortDescription}`;
      }).join('\n');

      return `PRODUCTOS DISPONIBLES EN KOKY FOOD:\n${context}`;
    } catch (error) {
      console.error("❌ Error cargando productos:", error.message);
      return "Información de productos no disponible por ahora.";
    }
  }
};