// @ts-nocheck
"use strict";

module.exports = {
  /**
   * Obtiene el resumen de producción para una fecha de entrega específica.
   */
  async getSummary(ctx) {
    try {
      let { date } = ctx.query;

      if (!date) {
        // Calcular por defecto el próximo día de entrega
        date = calculateDefaultDeliveryDate(new Date());
      }

      // Buscar órdenes del día
      const orders = await strapi.documents("api::order.order").findMany({
        filters: {
          delivery_date: date,
        },
      });

      const totals = {};
      let ordersCount = orders.length;

      // Consolidar cantidades ordenadas (excluyendo items Express/Disponible Hoy)
      for (const order of orders) {
        let items = order.items;
        if (typeof items === "string") {
          try {
            items = JSON.parse(items);
          } catch (e) {
            continue;
          }
        }
        if (!Array.isArray(items)) continue;

        for (const item of items) {
          if (!item.id) continue;
          
          // Omitimos productos comprados bajo la modalidad "Express" (Disponible Hoy), 
          // ya que provienen de stock existente y no requieren producción nocturna.
          if (item.availableToday === true) {
            continue;
          }

          if (!totals[item.id]) {
            let realSku = "SIN-SKU";
            try {
              const products = await strapi.documents("api::product.product").findMany({
                filters: { id: item.id }
              });
              if (products[0]) {
                realSku = products[0].sku || "SIN-SKU";
              }
            } catch (err) {
              strapi.log.error(`Error buscando SKU del producto ${item.id}: ${err.message}`);
            }

            totals[item.id] = {
              id: item.id,
              name: item.name,
              sku: realSku,
              slug: item.slug,
              contentPerUnit: Number(item.contentPerUnit) || 0,
              unitAbbreviation: item.unitAbbreviation || "",
              quantityOrdered: 0,
            };
          }
          totals[item.id].quantityOrdered += Number(item.quantity) || 0;
        }
      }

      // Convertir el mapa de totales a un array
      const productsSummary = Object.values(totals);

      // Calcular detalles de láminas especiales para Tofu Fresco (SKU: TOFU-BLAN-001)
      productsSummary.forEach((product) => {
        if (product.sku === "TOFU-BLAN-001") {
          const qty = product.quantityOrdered;
          // Tofu Blando se vende en paquetes de 500g (0.5 kg)
          const totalWeightKg = qty * 0.5;
          // Las prensas producen láminas de 2 kg
          const sheetsNeeded = Math.ceil(totalWeightKg / 2.0);
          const totalProducedKg = sheetsNeeded * 2.0;
          const leftoverKg = totalProducedKg - totalWeightKg;
          // Unidades equivalentes de 500g sobrantes
          const leftoverUnits = leftoverKg / 0.5;

          product.isTofuFresco = true;
          product.totalWeightKg = totalWeightKg;
          product.sheetsNeeded = sheetsNeeded;
          product.leftoverWeightKg = leftoverKg;
          product.leftoverUnits = leftoverUnits;
        }
      });

      ctx.body = {
        success: true,
        data: {
          deliveryDate: date,
          ordersCount,
          products: productsSummary,
        },
      };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },

  async debugOrders(ctx) {
    try {
      const orders = await strapi.documents("api::order.order").findMany({
        limit: 10,
        sort: { id: "desc" },
      });
      ctx.body = { success: true, orders };
    } catch (err) {
      ctx.body = { success: false, error: err.message };
    }
  },

  /**
   * Reconcilia la producción real entregada por la cocina, actualiza el inventario en Strapi
   * y añade los sobrantes de Tofu Fresco al inventario de Tofu Express.
   */
  async reconcile(ctx) {
    try {
      const { date, verifiedProducts } = ctx.request.body;

      if (!date || !Array.isArray(verifiedProducts)) {
        throw new Error("Datos de reconciliación incompletos.");
      }

      strapi.log.info(`[Reconciliación] Iniciando proceso para la fecha: ${date}`);

      for (const item of verifiedProducts) {
        const products = await strapi.documents("api::product.product").findMany({
          filters: { id: item.id },
        });
        const product = products[0];

        if (!product) {
          strapi.log.warn(`[Reconciliación] No se encontró el producto con id: ${item.id}`);
          continue;
        }

        const qtyExpected = Number(item.quantityOrdered) || 0;
        const qtyReturned = Number(item.quantityReturned) || 0;

        let updateData = {};

        if (product.sku === "TOFU-BLAN-001") {
          // El Tofu Fresco regular ordenado se suma al stock general
          const newStock = (product.stock || 0) + qtyExpected;
          
          // El excedente producido (sobrante de láminas) se inyecta directamente al stock express (disponible hoy)
          const leftoverUnits = Math.max(0, qtyReturned - qtyExpected);
          const newImmediateStock = (product.immediateDeliveryStock || 0) + leftoverUnits;

          updateData = {
            stock: newStock,
            immediateDeliveryStock: newImmediateStock,
            availableToday: newImmediateStock > 0 // Habilitar la oferta en la web si hay stock express
          };

          strapi.log.info(
            `[Reconciliación Tofu] Stock regular: ${product.stock} -> ${newStock}, Stock Express: ${product.immediateDeliveryStock} -> ${newImmediateStock}`
          );
        } else {
          // Para otros productos, el stock se incrementa con la cantidad devuelta por cocina
          const newStock = (product.stock || 0) + qtyReturned;
          updateData = { stock: newStock };

          strapi.log.info(`[Reconciliación] Producto ${product.name} stock: ${product.stock} -> ${newStock}`);
        }

        // Actualizar stock en la base de datos
        await strapi.documents("api::product.product").update({
          documentId: product.documentId,
          data: updateData,
        });
      }

      // Marcar las órdenes de este lote como reconciliadas
      const orders = await strapi.documents("api::order.order").findMany({
        filters: {
          delivery_date: date,
        },
      });

      for (const order of orders) {
        await strapi.documents("api::order.order").update({
          documentId: order.documentId,
          data: { reconciled: true },
        });
      }

      ctx.body = { success: true, message: "Inventario conciliado con éxito" };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },
};

/**
 * Calcula la fecha de entrega predeterminada (próximo día de despacho)
 */
function calculateDefaultDeliveryDate(now) {
  const date = new Date(now);
  const hour = date.getHours();
  const day = date.getDay(); // 0 = Dom, 1 = Lun, ..., 6 = Sáb

  let deliveryDate = new Date(date);

  if (day === 5) { // Viernes
    deliveryDate.setDate(date.getDate() + 3);
  } else if (day === 6) { // Sábado
    deliveryDate.setDate(date.getDate() + 2);
  } else if (day === 0) { // Domingo
    deliveryDate.setDate(date.getDate() + 1);
  } else { // Lunes a Jueves
    if (hour < 18) { // Antes de las 6 PM
      deliveryDate.setDate(date.getDate() + 1);
    } else { // Después de las 6 PM
      deliveryDate.setDate(date.getDate() + 2);
      if (deliveryDate.getDay() === 6) { // Si cae sábado, mover al lunes
        deliveryDate.setDate(deliveryDate.getDate() + 2);
      }
    }
  }

  const yyyy = deliveryDate.getFullYear();
  const mm = String(deliveryDate.getMonth() + 1).padStart(2, '0');
  const dd = String(deliveryDate.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
