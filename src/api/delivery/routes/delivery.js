// @ts-nocheck
"use strict";

module.exports = {
  routes: [
    {
      method: "GET",
      path: "/delivery/test-cabify", // Esta es la URL que escribirás en el navegador
      handler: "delivery.testConnection", // Nombre del controlador.método
      config: {
        auth: false, // Permitir acceso sin token para probar rápido
        policies: [],
        middlewares: [],
      },
    },
  ],
};
