"use strict";

const axios = require("axios");

module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;
    
    // Asignar automáticamente la fecha de entrega (delivery_date) si no viene definida
    if (!data.delivery_date) {
      data.delivery_date = calculateDeliveryDate(new Date());
      strapi.log.info(`[Lifecycle Order] Fecha de entrega calculada en beforeCreate: ${data.delivery_date}`);
    }
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;
    
    // Si se está actualizando el estado de la orden o las notas, guardamos el estado actual como "anterior"
    if (data && (data.order_status !== undefined || data.shipping_notes !== undefined)) {
      try {
        const existingOrder = await strapi.db.query("api::order.order").findOne({ where });
        if (existingOrder) {
          event.state = {
            previousStatus: existingOrder.order_status,
            whatsappId: existingOrder.whatsapp_id,
            customerName: existingOrder.customer_name,
            orderId: existingOrder.id,
            shippingNotes: existingOrder.shipping_notes
          };
        }
      } catch (err) {
        strapi.log.error(`[Lifecycle Order] Error en beforeUpdate: ${err.message}`);
      }
    }
  },

  async afterUpdate(event) {
    const { result, params } = event;
    const { data } = params;

    // Detectamos si el campo cabify_parcel_id está siendo actualizado y el stock no se ha descontado aún
    if (data && data.cabify_parcel_id && result && result.cabify_parcel_id && !result.stock_deducted) {
      try {
        strapi.log.info(`[Lifecycle Order] Descontando stock para la orden ID: ${result.id}`);
        await deductOrderStock(result);

        // Marcamos la orden con stock_deducted = true para no repetir el proceso
        await strapi.documents("api::order.order").update({
          documentId: result.documentId,
          data: {
            stock_deducted: true,
          },
        });
        await strapi.documents("api::order.order").publish({
          documentId: result.documentId,
        });
        strapi.log.info(`[Lifecycle Order] Stock marcado como descontado para la orden ID: ${result.id}`);
      } catch (err) {
        strapi.log.error(`[Lifecycle Order] Error al descontar stock en afterUpdate: ${err.message}`);
      }
    }

    // --- ENVÍO DE NOTIFICACIONES WHATSAPP POR CAMBIO DE ESTADO ---
    if (state && data && data.order_status && data.order_status !== state.previousStatus) {
      const newStatus = data.order_status;
      const to = state.whatsappId;
      const customerName = state.customerName || "Cliente";
      const orderId = state.orderId;

      if (to) {
        const phone_number_id = process.env.ID_PHONE_WS || "1037050959491352";
        const whatsapp_token = process.env.WHATSAPP_TOKEN;

        if (whatsapp_token) {
          try {
            if (newStatus === "PREPARING") {
              strapi.log.info(`[Lifecycle Order] Estado cambió a PREPARING. Enviando plantilla pedido_listo_cocina a ${to}...`);
              await sendWhatsAppTemplate(phone_number_id, whatsapp_token, to, "pedido_listo_cocina", [
                { type: "text", text: customerName },
                { type: "text", text: String(orderId) }
              ]);
            } else if (newStatus === "SHIPPED") {
              const deliveryWindow = (data.shipping_notes !== undefined ? data.shipping_notes : (state.shippingNotes || "en el transcurso de la tarde")).trim();
              strapi.log.info(`[Lifecycle Order] Estado cambió a SHIPPED. Enviando plantilla pedido_en_camino a ${to}...`);
              await sendWhatsAppTemplate(phone_number_id, whatsapp_token, to, "pedido_en_camino", [
                { type: "text", text: customerName },
                { type: "text", text: String(orderId) },
                { type: "text", text: deliveryWindow }
              ]);
            }
          } catch (wsErr) {
            strapi.log.error(`[Lifecycle Order] Error enviando plantilla de WhatsApp: ${wsErr.message}`);
          }
        } else {
          strapi.log.warn("[Lifecycle Order] WHATSAPP_TOKEN no configurado. Se omite envío de plantilla.");
        }
      }
    }
  },

  async afterCreate(event) {
    const { result } = event;

    strapi.log.info(
      `[Lifecycle Order] afterCreate ejecutado para la orden ID: ${result.id}, DocumentID: ${result.documentId}`
    );
  },
};

/**
 * Calcula la fecha de entrega según las reglas de negocio de Koky:
 * - Despachos de lunes a viernes.
 * - Sábado y Domingo no hay entregas, todos los pedidos de viernes, sábado y domingo se entregan el lunes.
 * - Lunes a Jueves: pedidos antes de las 16:00 (4:00 PM) se entregan mañana (D+1). Pedidos después de las 16:00 se entregan el día después (D+2). Si cae en sábado, se pasa al lunes.
 */
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

/**
 * Descuenta el stock de los productos incluidos en la orden.
 * Si el item indica que fue comprado como "Disponible Hoy" (availableToday), descuenta de immediateDeliveryStock.
 * De lo contrario, descuenta de stock regular.
 */
async function deductOrderStock(order) {
  if (!order || !order.items) return;

  let items = order.items;
  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch (e) {
      strapi.log.error(`[Stock Deduction] Error al parsear items: ${e.message}`);
      return;
    }
  }

  if (!Array.isArray(items)) return;

  for (const item of items) {
    if (!item.id) continue;

    try {
      // Buscar el producto por id numérico usando db.query
      const product = await strapi.db.query("api::product.product").findOne({
        where: {
          id: item.id,
        },
      });

      if (product) {
        const qty = Number(item.quantity) || 0;
        let updateData = {};

        if (item.availableToday === true) {
          // Descontar de Tofu Express (Disponible Hoy)
          const newImmediateStock = Math.max(0, (product.immediateDeliveryStock || 0) - qty);
          updateData = { immediateDeliveryStock: newImmediateStock };
          strapi.log.info(
            `[Stock] Producto ${product.name} (Express) stock anterior: ${product.immediateDeliveryStock}, nuevo: ${newImmediateStock}`
          );
        } else {
          // Descontar de stock regular
          const newStock = Math.max(0, (product.stock || 0) - qty);
          updateData = { stock: newStock };
          strapi.log.info(
            `[Stock] Producto ${product.name} regular stock anterior: ${product.stock}, nuevo: ${newStock}`
          );
        }

        // Actualizar en Strapi
        await strapi.documents("api::product.product").update({
          documentId: product.documentId,
          data: updateData,
        });
        await strapi.documents("api::product.product").publish({
          documentId: product.documentId,
        });
      }
    } catch (err) {
      strapi.log.error(
        `[Stock Deduction] Error al descontar stock del producto id ${item.id}: ${err.message}`
      );
    }
  }
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

async function sendWhatsAppTemplate(phone_number_id, token, to, templateName, bodyParameters) {
  try {
    await axios({
      method: "POST",
      url: `https://graph.facebook.com/v21.0/${phone_number_id}/messages`,
      data: {
        messaging_product: "whatsapp",
        to: to,
        type: "template",
        template: {
          name: templateName,
          language: { code: "es" },
          components: [
            {
              type: "body",
              parameters: bodyParameters
            }
          ]
        }
      },
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });
    strapi.log.info(`[Lifecycle Order] Plantilla de WhatsApp ${templateName} enviada con éxito a ${to}.`);
  } catch (err) {
    strapi.log.error(
      `[Lifecycle Order] Error en API de Meta al enviar plantilla ${templateName}:`,
      err.response?.data || err.message
    );
    throw err;
  }
}
