// @ts-nocheck

"use strict";

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { GoogleGenerativeAI } = require("@google/generative-ai");

const phoneUtil =
  require("google-libphonenumber").PhoneNumberUtil.getInstance();

const KiraPrompts = require("./kiraPrompts");

const ProductService = require("./product-service");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);

const model = genAI.getGenerativeModel(
  {
    model: "gemini-2.5-flash",
  },
  { apiVersion: "v1" },
);

// Set en memoria para deduplicar mensajes de webhook de WhatsApp y evitar respuestas múltiples
const processedMessageIds = new Set();

function getExtensionFromMime(mimeType) {
  const map = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/webm": ".webm",
    "audio/aac": ".aac",
    "audio/x-m4a": ".m4a",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/ogg": ".ogv",
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "text/plain": ".txt"
  };
  return map[mimeType] || "";
}

async function downloadWhatsAppMedia(mediaId) {
  try {
    const token = process.env.WHATSAPP_TOKEN;
    if (!token) {
      throw new Error("WHATSAPP_TOKEN no está configurado.");
    }
    
    // 1. Obtener la URL del recurso desde Meta Graph API (v21.0)
    console.log(`📡 Consultando URL de medio WhatsApp para ID: ${mediaId}`);
    const metaResponse = await axios.get(
      `https://graph.facebook.com/v21.0/${mediaId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
    const mediaUrl = metaResponse.data.url;
    const mimeType = metaResponse.data.mime_type;
    
    if (!mediaUrl) {
      throw new Error("No se obtuvo la URL de descarga del medio.");
    }

    // 2. Descargar el buffer binario usando la URL obtenida
    console.log(`📥 Descargando binario de medio desde: ${mediaUrl}`);
    const fileResponse = await axios.get(mediaUrl, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      responseType: "arraybuffer"
    });

    const ext = getExtensionFromMime(mimeType);
    const fileName = `wa_media_${mediaId}${ext}`;

    return {
      buffer: Buffer.from(fileResponse.data),
      mimeType,
      fileName
    };
  } catch (error) {
    console.error("❌ Error en downloadWhatsAppMedia:", error.message);
    throw error;
  }
}

async function downloadMetaAttachment(url) {
  try {
    console.log(`📥 Descargando adjunto Meta de: ${url}`);
    const response = await axios.get(url, {
      responseType: "arraybuffer"
    });
    
    const mimeType = response.headers["content-type"] || "image/jpeg";
    const ext = getExtensionFromMime(mimeType);
    const fileName = `meta_attachment_${Date.now()}${ext}`;
    
    return {
      buffer: Buffer.from(response.data),
      mimeType,
      fileName
    };
  } catch (error) {
    console.error("❌ Error en downloadMetaAttachment:", error.message);
    throw error;
  }
}

async function saveAndUploadToStrapi(buffer, mimeType, originalName, relationId) {
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, originalName);
  
  try {
    // 1. Guardar buffer temporalmente
    fs.writeFileSync(tempFilePath, buffer);
    const stats = fs.statSync(tempFilePath);
    
    const fileData = {
      path: tempFilePath,
      filepath: tempFilePath,
      name: originalName,
      originalFilename: originalName,
      type: mimeType,
      mimetype: mimeType,
      size: stats.size,
    };

    console.log(`🚀 Subiendo adjunto a Strapi: ${originalName} (${stats.size} bytes)`);

    // 2. Subir el archivo usando el servicio de carga de Strapi
    const uploadService = strapi.plugin('upload').service('upload');
    const uploadedFiles = await uploadService.upload({
      data: {
        refId: relationId,
        ref: 'api::chat.chat',
        field: 'attachments',
      },
      files: fileData,
    });

    console.log(`✅ Archivo subido correctamente. ID de medio:`, uploadedFiles?.[0]?.id);
    return uploadedFiles;
  } catch (uploadErr) {
    console.error(`❌ Error en saveAndUploadToStrapi: ${uploadErr.message}`);
    throw uploadErr;
  } finally {
    // 3. Limpiar archivo temporal
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (e) {
      console.error("⚠️ No se pudo borrar el archivo temporal:", e.message);
    }
  }
}

async function geocodeAddress(address) {
  const apiKey = process.env.G_MAPS_BACKEND_KEY || process.env.G_MAPS_KEY;
  if (!apiKey) {
    throw new Error("Ni G_MAPS_BACKEND_KEY ni G_MAPS_KEY están configuradas.");
  }
  
  let queryAddress = address;
  if (!address.toLowerCase().includes("bogota") && !address.toLowerCase().includes("bogotá")) {
    queryAddress = `${address}, Bogotá, Colombia`;
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json`;
  const response = await axios.get(url, {
    params: {
      address: queryAddress,
      key: apiKey
    }
  });

  if (response.data.status === "ZERO_RESULTS") {
    return { success: false, reason: "NOT_FOUND" };
  }

  if (response.data.status !== "OK") {
    console.error(`❌ Google Maps API error (${response.data.status}): ${response.data.error_message || ''}`);
    return { success: false, reason: "API_ERROR" };
  }

  const location = response.data.results[0].geometry.location;
  const formattedAddress = response.data.results[0].formatted_address;
  return {
    success: true,
    lat: location.lat,
    lng: location.lng,
    formattedAddress: formattedAddress
  };
}

async function getOrderContextForUser(from, user) {
  try {
    const filters = [];
    if (from) filters.push({ whatsapp_id: from });
    if (user?.whatsapp_id) filters.push({ whatsapp_id: user.whatsapp_id });
    if (user?.id) filters.push({ users_permissions_user: { id: user.id } });

    if (filters.length === 0) return "- No se encontraron órdenes asociadas.";

    const lastOrders = await strapi.db.query("api::order.order").findMany({
      where: { $or: filters },
      orderBy: { createdAt: "desc" },
      limit: 1
    });

    const lastOrder = lastOrders && lastOrders.length > 0 ? lastOrders[0] : null;

    if (!lastOrder) {
      return "- El cliente no tiene pedidos registrados en el sistema actualmente.";
    }

    const statusMap = {
      'PENDING': '🟡 Pendiente (Recibido)',
      'PREPARING': '🥣 En Cocina (Procesando)',
      'READY': '🟠 Listo de Cocina (Listo para despacho)',
      'SHIPPED': '🔵 ENVIADO (En camino hacia tu dirección)',
      'DELIVERED': '🟢 ENTREGADO (Completado)',
      'CANCELLED': '🔴 Cancelado'
    };

    const statusStr = statusMap[lastOrder.order_status] || lastOrder.order_status || 'PENDIENTE';
    const notesStr = lastOrder.shipping_notes ? ` (Notas de transporte/envío: ${lastOrder.shipping_notes})` : '';
    const dateStr = lastOrder.createdAt ? new Date(lastOrder.createdAt).toLocaleDateString('es-CO') : '';
    const courierStr = lastOrder.cabify_parcel_id ? 'Cabify Express' : 'Envíos Domicilio (Yango / Mensajero)';

    return `Última Orden #${lastOrder.id}:
- Fecha de Creación: ${dateStr}
- Estado del Pedido: ${statusStr}${notesStr}
- Estado del Pago: ${lastOrder.payment_status || 'PENDIENTE'}
- Valor Total: $${Number(lastOrder.total_amount || 0).toLocaleString('es-CO')} COP
- Dirección de Entrega: ${lastOrder.shipping_address || 'Bogotá'}
- Método de Entrega: ${courierStr}`;
  } catch (err) {
    console.error("❌ Error construyendo orderContext para Kira:", err.message);
    return "- No se pudo recuperar la orden reciente del cliente.";
  }
}

function calculateScore(msgText, previousScore = 0) {

  let score = Number(previousScore) || 0;

  const text = msgText.toLowerCase();

  if (
    text.includes("quiero") ||
    text.includes("me interesa") ||
    text.includes("cómo entro") ||
    text.includes("precio") ||
    text.includes("comprar") ||
    text.includes("unirme")
  ) {
    score += 2;
  }

  if (
    text.includes("fundador") ||
    text.includes("miembro") ||
    text.includes("invitación")
  ) {
    score += 3;
  }

  if (text.includes("?")) {
    score += 1;
  }

  if (text.includes("no gracias") || text.includes("no me interesa")) {
    score -= 2;
  }

  if (score < 0) score = 0;

  if (score > 10) score = 10;

  return Math.floor(score);
}

function getWompiCheckoutUrl(totalAmount, ref) {
  const crypto = require("crypto");
  const publicKey = process.env.WOMPI_PUBLIC_KEY || 'pub_test_kB5ENAJ1QA4hPWZYlcrehcyjFrhQyUdq';
  const amountInCents = Math.round(totalAmount * 100);
  const integrityKey = process.env.wompiIntegrityKey || process.env.WOMPI_INTEGRITY_KEY;
  
  let signatureHex = "";
  if (integrityKey) {
    const concatString = `${ref}${amountInCents}COP${integrityKey}`;
    signatureHex = crypto.createHash("sha256").update(concatString).digest("hex");
  }
  
  return `https://checkout.wompi.co/p/?public-key=${publicKey}&currency=COP&amount-in-cents=${amountInCents}&reference=${ref}&redirect-url=https://wa.me/573019447660${signatureHex ? `&signature:integrity=${signatureHex}` : ""}`;
}

async function getDynamicPromptsData() {
  try {
    const rules = await strapi.entityService.findMany("api::kira-rule.kira-rule", {
      filters: { active: true }
    });
    const faqs = await strapi.entityService.findMany("api::faq.faq", {
      filters: { active: true }
    });

    const rulesStr = rules.map((r, i) => `${i + 1}. [Instrucción: ${r.description}] => ${r.instruction}`).join("\n");
    const faqsStr = faqs.map((f, i) => `${i + 1}. [Tema: ${f.topic}] => ${f.information}`).join("\n");

    return { rulesStr, faqsStr };
  } catch (e) {
    console.error("❌ Error obteniendo reglas/FAQs dinámicas:", e.message);
    return { rulesStr: "", faqsStr: "" };
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

function isWithinSupportHours() {
  const now = new Date();
  
  // Convertir fecha actual a la hora de Bogotá, Colombia (UTC-5)
  const colTimeStr = now.toLocaleString("en-US", { timeZone: "America/Bogota" });
  const colDate = new Date(colTimeStr);
  
  const day = colDate.getDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
  const hours = colDate.getHours();
  const minutes = colDate.getMinutes();
  const timeVal = hours * 60 + minutes; // Minutos del día transcurridos

  const yyyy = colDate.getFullYear();
  const mm = String(colDate.getMonth() + 1).padStart(2, '0');
  const dd = String(colDate.getDate()).padStart(2, '0');
  const dateKey = `${yyyy}-${mm}-${dd}`;

  // Obtener los festivos dinámicos para el año actual
  const holidays = getColombianHolidays(yyyy);

  // Si es festivo en Colombia, no hay soporte humano disponible
  if (holidays.has(dateKey)) {
    return false;
  }

  // Lunes a Viernes: 8:00 AM (480 minutos) a 6:00 PM (1080 minutos)
  if (day >= 1 && day <= 5) {
    return timeVal >= 480 && timeVal <= 1080;
  }
  
  // Sábado: 9:00 AM (540 minutos) a 1:00 PM (780 minutos)
  if (day === 6) {
    return timeVal >= 540 && timeVal <= 780;
  }
  
  // Domingo: no hay atención
  return false;
}

function getTransferMessage() {
  const withinHours = isWithinSupportHours();
  return withinHours
    ? `Entendido. He pausado mis respuestas automáticas. Un compañero del equipo de carne y hueso revisará este chat muy pronto para ayudarte directamente. ¡Gracias por tu paciencia! 🥦`
    : `Entendido. He pausado mis respuestas automáticas. Ten en cuenta que nuestro equipo de soporte humano está disponible de lunes a viernes de 8:00 AM a 6:00 PM y sábados de 9:00 AM a 1:00 PM (domingos y festivos no tenemos soporte en vivo). Apenas nuestro equipo regrese, un compañero revisará tu mensaje. ¡Gracias por tu paciencia! 🥦`;
}

function shouldTakeoverHuman(msgText) {
  const clean = msgText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  // 1. Palabras clave directas (sin doble sentido en este negocio, usando límites de palabra)
  const directKeywords = [
    "asesor", "asesora",
    "operador", "operadora",
    "supervisor", "supervisora",
    "representante",
    "agente",
    "atencion al cliente"
  ];
  
  const hasDirectKeyword = directKeywords.some(keyword => {
    const cleanKeyword = keyword.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const regex = new RegExp(`\\b${cleanKeyword}s?\\b`, 'i');
    return regex.test(clean);
  });
  
  if (hasDirectKeyword) return true;

  // 2. Frases explícitas para palabras con doble sentido (como "humano", "persona", "soporte", "alguien")
  const explicitPhrases = [
    "hablar con un humano",
    "necesito un humano",
    "hablar con alguien",
    "hablar con una persona",
    "necesito una persona",
    "humano por favor",
    "soporte por favor",
    "contacto humano",
    "hablar con soporte",
    "necesito soporte",
    "ayuda humana",
    "transferir a un humano",
    "conectarme con un humano",
    "hablar con un humano de verdad",
    "hablar con alguien real",
    "necesito hablar con alguien",
    "quiero hablar con alguien",
    "quiero un humano",
    "necesito ayuda de una persona"
  ];

  return explicitPhrases.some(phrase => {
    const cleanPhrase = phrase.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return clean.includes(cleanPhrase);
  });
}

module.exports = {
  async getOrCreateUser(
    identifier,
    waName,
    platform = "whatsapp",
    avatarUrl = null,
    handle = null,
  ) {
    let domain = "koky.food";

    if (platform === "instagram") domain = "instagram.koky";

    if (platform === "facebook") domain = "facebook.koky";

    const virtualEmail = `${identifier}@${domain}`;

    let user = await strapi.db.query("plugin::users-permissions.user").findOne({
      where: {
        $or: [{ email: virtualEmail }, { whatsapp_id: identifier }],
      },
    });

    if (!user) {
      user = await strapi.plugins["users-permissions"].services.user.add({
        username: waName,

        email: virtualEmail,

        password: "Password123!",

        confirmed: true,

        is_founder: false,

        whatsapp_id: platform === "whatsapp" ? identifier : null,

        avatar_url: avatarUrl,

        social_id: identifier,

        social_handle: handle,

        kira_active: true,
      });
    } else {
      const updateData = {};

      if (avatarUrl && user.avatar_url !== avatarUrl)
        updateData.avatar_url = avatarUrl;

      if (waName && waName !== "Cliente" && user.username !== waName)
        updateData.username = waName;

      if (handle && user.social_handle !== handle)
        updateData.social_handle = handle;

      if (Object.keys(updateData).length > 0) {
        user = await strapi.entityService.update(
          "plugin::users-permissions.user",
          user.id,
          {
            data: updateData,
          },
        );
      }
    }

    return user;
  },

  async sendWhatsAppMessage(phone_number_id, to, text) {
    try {
      await axios({
        method: "POST",
        url: `https://graph.facebook.com/v21.0/${phone_number_id}/messages`,
        data: {
          messaging_product: "whatsapp",
          to: to,
          text: { body: text },
        },
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        },
      });
    } catch (err) {
      console.error("❌ Error enviando mensaje de WhatsApp:", err.response?.data || err.message);
    }
  },

  async buildCartFromNames(items) {
    try {
      const products = await strapi.entityService.findMany("api::product.product", {
        filters: { active: true },
        populate: { image: true }
      });

      let itemsToSave = [];
      let itemsTextList = [];
      let total = 0;

      for (const item of items) {
        const cleanItemName = item.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const dbProd = products.find(p => {
          const cleanProdName = p.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
          return cleanProdName === cleanItemName;
        });

        if (dbProd) {
          let imageUrl = "";
          if (dbProd.image && dbProd.image.url) {
            const path = dbProd.image.url;
            imageUrl = path.startsWith("http")
              ? path
              : `https://koky-backend-production.up.railway.app${path}`;
          }
          const qty = Number(item.quantity) || 1;
          const itemTotal = Number(dbProd.price) * qty;
          total += itemTotal;
          itemsTextList.push(`- ${qty}x ${dbProd.name} ($${Number(dbProd.price).toLocaleString('es-CO')} COP)`);
          itemsToSave.push({
            id: dbProd.id,
            name: dbProd.name,
            price: Number(dbProd.price),
            quantity: qty,
            image: imageUrl
          });
        }
      }

      if (itemsToSave.length === 0) return null;

      return {
        items: itemsToSave,
        subtotal: total,
        listText: itemsTextList.join("\n")
      };
    } catch (e) {
      console.error("❌ Error en buildCartFromNames:", e.message);
      return null;
    }
  },

  async sendDeliveryFlow(phone_number_id, to, listText, subtotal) {
    const flowId = process.env.WHATSAPP_FLOW_ID;
    if (!flowId) {
      console.warn("⚠️ WHATSAPP_FLOW_ID no está configurada en las variables de entorno.");
      return;
    }
    try {
      await axios({
        method: "POST",
        url: `https://graph.facebook.com/v21.0/${phone_number_id}/messages`,
        data: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: to,
          type: "interactive",
          interactive: {
            type: "flow",
            header: {
              type: "text",
              text: "Confirmar Pedido"
            },
            body: {
              text: `Detalles de tu compra:\n${listText}\nTotal: $${subtotal.toLocaleString('es-CO')} COP`
            },
            footer: {
              text: "Koky Food"
            },
            action: {
              name: "flow",
              parameters: {
                flow_message_version: "3",
                flow_token: `cart_${Date.now()}`,
                flow_id: flowId,
                flow_cta: "Confirmar Entrega",
                flow_action: "navigate",
                mode: process.env.WHATSAPP_FLOW_MODE || "published",
                flow_action_payload: {
                  screen: "DELIVERY_SCREEN",
                  data: {
                    cart_total_text: `Subtotal de comida: $${subtotal.toLocaleString('es-CO')} COP`,
                    items_summary: `Detalles de tus productos:\n${listText}`
                  }
                }
              }
            }
          }
        },
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      });
    } catch (err) {
      console.error("❌ Error enviando Flow:", err.response?.data || err.message);
    }
  },

  async sendHousingConfirmation(phone_number_id, to, address, isAlreadyComplete) {
    const buttons = isAlreadyComplete 
      ? [
          {
            type: "reply",
            reply: {
              id: "btn_si",
              title: "👍 Sí, es correcta"
            }
          },
          {
            type: "reply",
            reply: {
              id: "btn_corregir",
              title: "✏️ Corregir"
            }
          }
        ]
      : [
          {
            type: "reply",
            reply: {
              id: "btn_casa",
              title: "🏠 Casa"
            }
          },
          {
            type: "reply",
            reply: {
              id: "btn_apto",
              title: "🏢 Apartamento"
            }
          },
          {
            type: "reply",
            reply: {
              id: "btn_corregir",
              title: "✏️ Corregir"
            }
          }
        ];

    const bodyText = isAlreadyComplete 
      ? `📍 Confirmemos tu dirección:\n👉 **${address}**\n\n¿Esta dirección y detalles de apartamento son correctos?`
      : `📍 Ubicamos tu dirección:\n👉 **${address}**\n\n¿Vives en una casa o en un apartamento?`;

    try {
      await axios({
        method: "POST",
        url: `https://graph.facebook.com/v21.0/${phone_number_id}/messages`,
        data: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: to,
          type: "interactive",
          interactive: {
            type: "button",
            body: {
              text: bodyText
            },
            action: {
              buttons: buttons
            }
          }
        },
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      });
    } catch (err) {
      console.error("❌ Error enviando botones de confirmación de vivienda:", err.response?.data || err.message);
      const fallbackText = isAlreadyComplete
        ? `📍 Confirmemos tu dirección:\n👉 **${address}**\n\n¿Es correcta? Responde con *Sí* o *Corregir*.`
        : `📍 Confirmemos tu dirección:\n👉 **${address}**\n\n¿Vives en una casa o apartamento? Responde con *Casa*, *Apartamento* o *Corregir*.`;
      await this.sendWhatsAppMessage(phone_number_id, to, fallbackText);
    }
  },

  async sendWompiPaymentLink(phone_number_id, to, orderId, listText, deliveryCost, totalAmount, address, details, checkoutUrl) {
    let messageBody = `¡Pedido recibido! 🥦 (Orden #${orderId})\n\n`;
    messageBody += `📋 **Detalles del Pedido:**\n${listText}\n\n`;
    messageBody += `🛵 **Envío:** $${deliveryCost.toLocaleString('es-CO')} COP\n`;
    messageBody += `💰 **Total Final:** $${totalAmount.toLocaleString('es-CO')} COP\n\n`;
    messageBody += `📍 **Dirección:** ${address}\n`;
    if (details) {
      messageBody += `🏢 **Detalles:** ${details}\n`;
    }
    messageBody += `\n💳 Completa tu pago seguro con Wompi (Nequi, Daviplata, PSE, Tarjeta) haciendo clic en el botón de abajo.`;

    try {
      await axios({
        method: "POST",
        url: `https://graph.facebook.com/v21.0/${phone_number_id}/messages`,
        data: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: to,
          type: "interactive",
          interactive: {
            type: "cta_url",
            header: {
              type: "text",
              text: "Pago Seguro 💳"
            },
            body: {
              text: messageBody
            },
            footer: {
              text: "Koky Food"
            },
            action: {
              name: "cta_url",
              parameters: {
                display_text: "Pagar con Wompi",
                url: checkoutUrl
              }
            }
          }
        },
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      });
    } catch (err) {
      console.error("❌ Error enviando link de pago de Wompi:", err.response?.data || err.message);
      await this.sendWhatsAppMessage(phone_number_id, to, messageBody + `\n\nEnlace de pago: ${checkoutUrl}`);
    }
  },

  async verify(ctx) {
    const verifyToken = "me_encanta_koky";

    const mode = ctx.query["hub.mode"];

    const token = ctx.query["hub.verify_token"];

    const challenge = ctx.query["hub.challenge"];

    if (mode && token && mode === "subscribe" && token === verifyToken) {
      ctx.status = 200;

      ctx.body = challenge;
    } else {
      ctx.status = 403;
    }
  },

  async receive(ctx) {
    const body = ctx.request.body;

    console.log("📥 Recibiendo webhook en backend...");

    ctx.status = 200;

    ctx.body = "EVENT_RECEIVED";

    setImmediate(async () => {
      try {
        // ==========================================

        // ECOISTEMA 1: WHATSAPP BUSINESS

        // ==========================================

        if (body.object === "whatsapp_business_account") {
          const entry = body.entry?.[0]?.changes?.[0]?.value;

          const message = entry?.messages?.[0];

          const contact = entry?.contacts?.[0];

          if (message) {
            // Deduplicar webhooks duplicados usando el ID único del mensaje de WhatsApp
            const messageId = message.id;
            if (messageId) {
              if (processedMessageIds.has(messageId)) {
                console.log(`⚠️ Webhook duplicado ignorado para el mensaje ID: ${messageId}`);
                return;
              }
              processedMessageIds.add(messageId);
              
              // Limitar tamaño para evitar fugas de memoria
              if (processedMessageIds.size > 1000) {
                const oldestId = processedMessageIds.values().next().value;
                processedMessageIds.delete(oldestId);
              }
            }

            const phone_number_id = entry.metadata.phone_number_id;

            const from = message.from;

            const waName = contact?.profile?.name || "Cliente Koky";

            let user = await this.getOrCreateUser(from, waName, "whatsapp");
            user = await strapi.entityService.update(
              "plugin::users-permissions.user",
              user.id,
              { data: { unread: true } }
            );

            let rawText = message.text?.body || message.button?.text || "";
            let buttonId = "";
            if (message.type === "interactive" && message.interactive?.type === "button_reply") {
              rawText = message.interactive.button_reply.title || "";
              buttonId = message.interactive.button_reply.id || "";
            }

            // --- DETECCION DE MEDIOS WHATSAPP ---
            let mediaAttachmentId = null;
            let mediaType = null;
            let mediaMimeType = null;
            if (["image", "document", "audio", "video", "sticker", "voice"].includes(message.type)) {
              const mediaObj = message[message.type];
              if (mediaObj && mediaObj.id) {
                mediaAttachmentId = mediaObj.id;
                mediaType = message.type;
                mediaMimeType = mediaObj.mime_type;
                
                if (mediaObj.caption) {
                  rawText = mediaObj.caption;
                } else {
                  const typeLabels = {
                    image: "📷 Imagen",
                    document: "📄 Documento",
                    audio: "🎵 Audio",
                    voice: "🎙️ Nota de voz",
                    video: "🎥 Video",
                    sticker: "🎨 Sticker"
                  };
                  rawText = typeLabels[message.type] || `📎 Archivo adjunto (${message.type})`;
                }
              }
            }


            // Si el mensaje es una URL de WhatsApp (wa.me o api.whatsapp.com), extraemos el texto predefinido
            if (rawText && (rawText.includes("wa.me") || rawText.includes("api.whatsapp.com"))) {
              try {
                let urlString = rawText.trim();
                if (!urlString.startsWith("http://") && !urlString.startsWith("https://")) {
                  urlString = "https://" + urlString;
                }
                const urlObj = new URL(urlString);
                const textParam = urlObj.searchParams.get("text");
                if (textParam) {
                  rawText = decodeURIComponent(textParam);
                }
              } catch (e) {
                // Si falla el parseo, dejamos el texto original
              }
            }

            // Obtener el estado real del usuario de la base de datos para verificar si la IA está activa
            const dbUser = await strapi.db.query("plugin::users-permissions.user").findOne({
              where: { id: user.id }
            });
            const isKiraActive = dbUser && dbUser.kira_active !== false && dbUser.kira_active !== 0 && dbUser.kira_active !== '0';

            // --- NOTIFICACIONES AL ADMINISTRADOR (Mensajes ordinarios) ---
            if (!shouldTakeoverHuman(rawText)) {
              const adminPhone = process.env.ADMIN_PHONE || "573007979419";
              if (adminPhone && from !== adminPhone) {
                const header = isKiraActive ? "💬 *Mensaje para Kira*" : "👤 *Mensaje para Humano*";
                const note = isKiraActive ? "" : "\n\n_Nota: Kira está desactivada en este chat._";
                const infoMsg = `${header}\n\n*Cliente:* ${waName} (${from})\n*Mensaje:* "${rawText}"${note}`;
                await this.sendWhatsAppMessage(phone_number_id, adminPhone, infoMsg);
              }
            }

            // --- CAPA 1: Interceptador de Handoff Humano por Código (WhatsApp) ---
            if (isKiraActive && shouldTakeoverHuman(rawText)) {
              console.log(`⚠️ Cliente WhatsApp ${from} solicita hablar con un humano. Pausando bot Kira.`);
              
              user = await strapi.entityService.update(
                "plugin::users-permissions.user",
                user.id,
                { data: { kira_active: false } }
              );

              // NOTIFICACIÓN AL ADMINISTRADOR
              const adminPhone = process.env.ADMIN_PHONE || "573007979419";
              if (adminPhone && from !== adminPhone) {
                const alertMsg = `🚨 *Solicitud de Atención Humana*\n\nEl cliente *${waName}* (${from}) solicita hablar con un humano.\n\n*Último mensaje:* "${rawText}"\n\n_Kira ha sido pausada en este chat. Por favor, asume la conversación._`;
                await this.sendWhatsAppMessage(phone_number_id, adminPhone, alertMsg);
              }

              const chatMsg = await strapi.entityService.create("api::chat.chat", {
                data: {
                  sender: from,
                  message: rawText,
                  timestamp: new Date(),
                  publishedAt: new Date(),
                  users_permissions_user: user.id,
                },
              });

              if (mediaAttachmentId) {
                setImmediate(async () => {
                  try {
                    const mediaInfo = await downloadWhatsAppMedia(mediaAttachmentId);
                    await saveAndUploadToStrapi(
                      mediaInfo.buffer,
                      mediaInfo.mimeType,
                      mediaInfo.fileName,
                      chatMsg.id
                    );
                    if (strapi["io"]) {
                      strapi["io"].emit("new_message", { userId: user.id });
                    }
                  } catch (err) {
                    console.error("❌ Error descargando/subiendo adjunto de WhatsApp:", err.message);
                  }
                });
              }


              const transferMessage = getTransferMessage();
              await this.sendWhatsAppMessage(phone_number_id, from, transferMessage);

              await strapi.entityService.create("api::chat.chat", {
                data: {
                  sender: "Kira",
                  message: transferMessage,
                  timestamp: new Date(),
                  publishedAt: new Date(),
                  users_permissions_user: user.id,
                },
              });

              if (strapi["io"]) {
                strapi["io"].emit("new_message", { userId: user.id });
              }

              return;
            }
            let isSystemInteractive = false;
            let systemInteractiveResponse = "";
            let skipStateMachine = false;

            // 1. Procesar carritos de compras nativos de WhatsApp
            if (message.type === "order" && message.order) {
              skipStateMachine = true;
              const items = message.order.product_items || [];
              let itemsTextList = [];
              let itemsToSave = [];
              let total = 0;

              for (const item of items) {
                const retailerId = item.product_retailer_id;
                const quantity = Number(item.quantity) || 1;

                const product = await strapi.db.query("api::product.product").findOne({
                  where: {
                    $or: [
                      { sku: retailerId },
                      { id: isNaN(Number(retailerId)) ? -1 : Number(retailerId) }
                    ]
                  },
                  populate: { image: true }
                });

                if (product) {
                  let imageUrl = "";
                  if (product.image && product.image.url) {
                    const path = product.image.url;
                    imageUrl = path.startsWith("http")
                      ? path
                      : `https://koky-backend-production.up.railway.app${path}`;
                  }

                  const itemTotal = Number(product.price) * quantity;
                  total += itemTotal;
                  itemsTextList.push(`- ${quantity}x ${product.name} ($${Number(product.price).toLocaleString('es-CO')} COP)`);
                  itemsToSave.push({
                    id: product.id,
                    name: product.name,
                    price: Number(product.price),
                    quantity: quantity,
                    image: imageUrl
                  });
                } else {
                  itemsTextList.push(`- ${quantity}x Producto ID: ${retailerId}`);
                  itemsToSave.push({
                    id: retailerId,
                    name: `Producto ID: ${retailerId}`,
                    price: 0,
                    quantity: quantity
                  });
                }
              }

              const listText = itemsTextList.join("\n");
              rawText = `🛒 [Carrito enviado]\n${listText}\nTotal: $${total.toLocaleString('es-CO')} COP`;

              // Buscar historial de pedidos del cliente para ver si tiene direcciones registradas
              const cleanFrom = from.replace(/^\+?57/, "");
              const pastOrders = await strapi.db.query("api::order.order").findMany({
                where: {
                  $or: [
                    { whatsapp_id: from },
                    { whatsapp_id: `+${from}` },
                    { whatsapp_id: cleanFrom },
                    { whatsapp_id: `+${cleanFrom}` }
                  ]
                },
                orderBy: { createdAt: "desc" },
                limit: 50
              });

              const uniqueAddresses = [];
              const seenAddresses = new Set();
              for (const order of pastOrders) {
                if (order.shipping_address) {
                  const normalized = order.shipping_address.trim().toLowerCase();
                  if (!seenAddresses.has(normalized)) {
                    seenAddresses.add(normalized);
                    uniqueAddresses.push({
                      address: order.shipping_address,
                      latitude: Number(order.shipping_latitude),
                      longitude: Number(order.shipping_longitude),
                      notes: order.shipping_notes || ""
                    });
                    if (uniqueAddresses.length >= 5) break;
                  }
                }
              }

              user.kira_score = {
                ...user.kira_score,
                active_cart: {
                  items: itemsToSave,
                  subtotal: total,
                  listText: listText
                }
              };

              if (uniqueAddresses.length > 0) {
                // Guardar las direcciones temporales y esperar selección por chat
                user.kira_score.temp_addresses = uniqueAddresses;
                user.kira_score.checkout_state = "AWAITING_ADDRESS_SELECTION";
                
                await strapi.entityService.update("plugin::users-permissions.user", user.id, {
                  data: { kira_score: user.kira_score }
                });

                const addressOptions = uniqueAddresses.map((addr, idx) => `${idx + 1}️⃣ **${addr.address}**`).join("\n");
                systemInteractiveResponse = `¡Recibí tu pedido! 🛒\n\n¿A qué dirección lo enviamos?\n\n${addressOptions}\n\nResponde con el número de la dirección (ej. 1), o escribe **"Nueva"** para enviar a otra dirección.`;
                isSystemInteractive = true;

                setImmediate(async () => {
                  await this.sendWhatsAppMessage(phone_number_id, from, systemInteractiveResponse);
                });
              } else {
                // No hay direcciones previas, enviar el Flow de una vez
                user.kira_score.checkout_state = "AWAITING_FLOW_SUBMISSION";
                
                await strapi.entityService.update("plugin::users-permissions.user", user.id, {
                  data: { kira_score: user.kira_score }
                });

                const flowId = process.env.WHATSAPP_FLOW_ID;
                if (flowId) {
                  systemInteractiveResponse = `¡Recibí tu pedido! 🛒\n\nPor favor, completa tus datos de entrega presionando el botón "Confirmar Entrega" aquí abajo.`;
                  isSystemInteractive = true;

                  setImmediate(async () => {
                    try {
                      await axios({
                        method: "POST",
                        url: `https://graph.facebook.com/v21.0/${phone_number_id}/messages`,
                        data: {
                          messaging_product: "whatsapp",
                          recipient_type: "individual",
                          to: from,
                          type: "interactive",
                          interactive: {
                            type: "flow",
                            header: {
                              type: "text",
                              text: "Confirmar Pedido"
                            },
                            body: {
                              text: `Detalles de tu compra:\n${listText}\nTotal: $${total.toLocaleString('es-CO')} COP`
                            },
                            footer: {
                              text: "Koky Food"
                            },
                            action: {
                              name: "flow",
                              parameters: {
                                flow_message_version: "3",
                                flow_token: `cart_${Date.now()}`,
                                flow_id: flowId,
                                flow_cta: "Confirmar Entrega",
                                flow_action: "navigate",
                                mode: process.env.WHATSAPP_FLOW_MODE || "published",
                                flow_action_payload: {
                                  screen: "DELIVERY_SCREEN",
                                  data: {
                                  cart_total_text: `Subtotal de comida: $${total.toLocaleString('es-CO')} COP`,
                                  items_summary: `Detalles de tus productos:\n${listText}`
                                  }
                                }
                              }
                            }
                          }
                        },
                        headers: {
                          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                          "Content-Type": "application/json"
                        }
                      });
                    } catch (err) {
                      console.error("❌ Error enviando Flow:", err.response?.data || err.message);
                    }
                  });
                } else {
                  systemInteractiveResponse = `¡Recibí tu pedido! 🛒\n\nPronto te contactaremos por aquí para confirmar la entrega. ¡Gracias por elegir Koky! 🥦`;
                  isSystemInteractive = true;

                  setImmediate(async () => {
                    await this.sendWhatsAppMessage(phone_number_id, from, systemInteractiveResponse);
                  });
                }
              }
            }
            // 2. Procesar respuestas de WhatsApp Flows
            else if (message.type === "interactive" && message.interactive?.type === "nfm_reply") {
              skipStateMachine = true;
              const flowReply = message.interactive.nfm_reply;
              try {
                const responseData = JSON.parse(flowReply.response_json);
                console.log("📥 Flow Response Data:", responseData);
                
                const name = responseData.customer_name || waName;
                const address = responseData.shipping_address;
                const notes = responseData.shipping_notes || "";
                const paymentMethod = "wompi"; // Forzar pago con Wompi

                const activeCart = user.kira_score?.active_cart;
                if (!activeCart) {
                  throw new Error("No hay un carrito activo para este usuario.");
                }

                // 1. Geocodificar la dirección usando Google Maps
                let lat = 4.6976;
                let lng = -74.0617;
                let formattedAddress = address;
                let isAddressReal = true;

                try {
                  const geocoded = await geocodeAddress(address);
                  if (geocoded.success) {
                    lat = geocoded.lat;
                    lng = geocoded.lng;
                    formattedAddress = geocoded.formattedAddress;
                  } else {
                    isAddressReal = false;
                  }
                } catch (geocodeErr) {
                  console.error("❌ Error de red/sistema en geocodeAddress:", geocodeErr.message);
                }

                if (!isAddressReal) {
                  // Informar de error y reenviar Flow
                  const errorMsg = `❌ No logramos ubicar la dirección *"${address}"*. Por favor, abre de nuevo el formulario e ingresa una dirección completa con calle y número.`;
                  await this.sendWhatsAppMessage(phone_number_id, from, errorMsg);
                  await this.sendDeliveryFlow(phone_number_id, from, activeCart.listText, activeCart.subtotal);
                  return;
                }

                // Guardar los datos en el checkout temporal
                user.kira_score.temp_checkout = {
                  customer_name: name,
                  shipping_address: formattedAddress,
                  latitude: Number(lat),
                  longitude: Number(lng),
                  shipping_notes: notes,
                  active_cart: {
                    items: activeCart.items,
                    subtotal: activeCart.subtotal,
                    listText: activeCart.listText
                  }
                };

                // Detección inteligente de apartamento/casa en el texto de dirección escrito
                const cleanAddress = address.toLowerCase();
                const hasApartmentInfo = /\b(apt|apto|apartamento|dep|depto|casa\s*\d+|casa\s*[a-z])\b/i.test(cleanAddress);

                if (hasApartmentInfo) {
                  user.kira_score.checkout_state = "AWAITING_SIMPLE_CONFIRMATION";
                  await strapi.entityService.update("plugin::users-permissions.user", user.id, {
                    data: { kira_score: user.kira_score }
                  });
                  await this.sendHousingConfirmation(phone_number_id, from, formattedAddress, true);
                } else {
                  user.kira_score.checkout_state = "AWAITING_HOUSING_TYPE";
                  await strapi.entityService.update("plugin::users-permissions.user", user.id, {
                    data: { kira_score: user.kira_score }
                  });
                  await this.sendHousingConfirmation(phone_number_id, from, formattedAddress, false);
                }

                systemInteractiveResponse = `📍 Dirección geocodificada: ${formattedAddress}. Esperando confirmación del cliente en chat.`;
                isSystemInteractive = true;
              } catch (e) {
                console.error("❌ Error en nfm_reply:", e.message);
                rawText = `📋 [Formulario completado (Error al procesar pedido)]`;
              }
            }

            const msgText = rawText.toLowerCase().trim();

            console.log("🔍 Procesando mensaje de:", phone_number_id);

            try {
              // 3. Máquina de estados para selección de dirección y pago en chat
              if (!skipStateMachine && user.kira_score && user.kira_score.checkout_state) {
                const checkoutState = user.kira_score.checkout_state;

                if (checkoutState === "AWAITING_ADDRESS_SELECTION") {
                  if (msgText.includes("nueva") || msgText.includes("otra") || msgText.includes("cambiar")) {
                    const flowId = process.env.WHATSAPP_FLOW_ID;
                    const activeCart = user.kira_score.active_cart;

                    user.kira_score.checkout_state = "AWAITING_FLOW_SUBMISSION";
                    await strapi.entityService.update("plugin::users-permissions.user", user.id, {
                      data: { kira_score: user.kira_score }
                    });

                    systemInteractiveResponse = `¡Entendido! Completemos tus nuevos datos de entrega y método de pago en el formulario de abajo.`;
                    isSystemInteractive = true;

                    setImmediate(async () => {
                      try {
                        await this.sendWhatsAppMessage(phone_number_id, from, systemInteractiveResponse);
                        
                        await axios({
                          method: "POST",
                          url: `https://graph.facebook.com/v21.0/${phone_number_id}/messages`,
                          data: {
                            messaging_product: "whatsapp",
                            recipient_type: "individual",
                            to: from,
                            type: "interactive",
                            interactive: {
                              type: "flow",
                              header: {
                                type: "text",
                                text: "Confirmar Pedido"
                              },
                              body: {
                                text: `Detalles de tu compra:\n${activeCart.listText}\nTotal: $${activeCart.subtotal.toLocaleString('es-CO')} COP`
                              },
                              footer: {
                                text: "Koky Food"
                              },
                              action: {
                                name: "flow",
                                parameters: {
                                  flow_message_version: "3",
                                  flow_token: `cart_${Date.now()}`,
                                  flow_id: flowId,
                                  flow_cta: "Confirmar Entrega",
                                  flow_action: "navigate",
                                  mode: process.env.WHATSAPP_FLOW_MODE || "published",
                                  flow_action_payload: {
                                    screen: "DELIVERY_SCREEN",
                                    data: {
                                      cart_total_text: `Subtotal de comida: $${activeCart.subtotal.toLocaleString('es-CO')} COP`,
                                      items_summary: `Detalles de tus productos:\n${activeCart.listText}`
                                    }
                                  }
                                }
                              }
                            }
                          },
                          headers: {
                            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                            "Content-Type": "application/json"
                          }
                        });
                      } catch (err) {
                        console.error("❌ Error enviando Flow:", err.response?.data || err.message);
                      }
                    });
                  } else {
                    const selectionIdx = parseInt(msgText) - 1;
                    if (!isNaN(selectionIdx) && selectionIdx >= 0 && user.kira_score.temp_addresses && selectionIdx < user.kira_score.temp_addresses.length) {
                      const selected = user.kira_score.temp_addresses[selectionIdx];
                      
                      const activeCart = user.kira_score.active_cart;

                      let deliveryCost = 10000;
                      try {
                        const cabifyResult = await strapi
                          .service("api::cabify-delivery.cabify-delivery")
                          .getPriceEstimate({
                            dropoff_location: { lat: selected.latitude, lon: selected.longitude },
                            dimensions: { height: 10, length: 10, width: 10, unit: "cm" },
                            weight: { value: 1000, unit: "g" },
                          });
                        if (cabifyResult?.deliveries?.[0]?.estimation?.price?.amount) {
                          deliveryCost = cabifyResult.deliveries[0].estimation.price.amount;
                        }
                      } catch (e) {
                        console.error("❌ Error calculando Cabify para dirección histórica:", e.message);
                      }

                      const totalAmount = activeCart.subtotal + deliveryCost;

                      const ref = `WA_${Date.now()}`;
                      const newOrder = await strapi.entityService.create("api::order.order", {
                        data: {
                          whatsapp_id: String(from),
                          customer_name: user.username || "Cliente WhatsApp",
                          total_amount: Number(totalAmount),
                          wompi_reference: ref,
                          source: "whatsapp",
                          items: activeCart.items,
                          payment_method: "CARD",
                          shipping_address: selected.address,
                          shipping_latitude: Number(selected.latitude),
                          shipping_longitude: Number(selected.longitude),
                          shipping_notes: selected.notes || "",
                          users_permissions_users: [user.id],
                          publishedAt: new Date()
                        }
                      });

                      user.kira_score.checkout_state = null;
                      user.kira_score.active_cart = null;
                      user.kira_score.selected_address = null;
                      user.kira_score.temp_addresses = null;
                      await strapi.entityService.update("plugin::users-permissions.user", user.id, {
                        data: { kira_score: user.kira_score }
                      });

                      let messageBody = `¡Pedido confirmado! 🥦 (Orden #${newOrder.id})\n\n`;
                      messageBody += `📋 **Detalles del Pedido:**\n${activeCart.listText}\n\n`;
                      messageBody += `🛵 **Envío:** $${deliveryCost.toLocaleString('es-CO')} COP\n`;
                      messageBody += `💰 **Total Final:** $${totalAmount.toLocaleString('es-CO')} COP\n\n`;
                      messageBody += `📍 **Dirección:** ${selected.address}\n\n`;

                      const checkoutUrl = getWompiCheckoutUrl(totalAmount, ref);
                      messageBody += `💳 Completa tu pago seguro con Wompi (Nequi, Daviplata, PSE, Tarjeta) haciendo clic en el botón de abajo.`;
                      systemInteractiveResponse = messageBody + `\n\n[Botón de Pago enviado: ${checkoutUrl}]`;
                      isSystemInteractive = true;

                      setImmediate(async () => {
                        try {
                          await axios({
                            method: "POST",
                            url: `https://graph.facebook.com/v21.0/${phone_number_id}/messages`,
                            data: {
                              messaging_product: "whatsapp",
                              recipient_type: "individual",
                              to: from,
                              type: "interactive",
                              interactive: {
                                type: "cta_url",
                                header: {
                                  type: "text",
                                  text: "Pago Seguro 💳"
                                },
                                body: {
                                  text: messageBody
                                },
                                footer: {
                                  text: "Koky Food"
                                },
                                action: {
                                  name: "cta_url",
                                  parameters: {
                                    display_text: "Pagar con Wompi",
                                    url: checkoutUrl
                                  }
                                }
                              }
                            },
                            headers: {
                              Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                              "Content-Type": "application/json"
                            }
                          });
                        } catch (err) {
                          console.error("❌ Error enviando CTA URL de Wompi (Histórico):", err.response?.data || err.message);
                          await this.sendWhatsAppMessage(phone_number_id, from, messageBody + `\n\nEnlace de pago: ${checkoutUrl}`);
                        }
                      });
                    } else {
                      systemInteractiveResponse = `Por favor, responde con el número de la dirección que prefieras (ej. 1) o escribe **"Nueva"** para usar otra dirección.`;
                      isSystemInteractive = true;

                      setImmediate(async () => {
                        await this.sendWhatsAppMessage(phone_number_id, from, systemInteractiveResponse);
                      });
                    }
                  }
                } else if (checkoutState === "AWAITING_FLOW_SUBMISSION") {
                  const activeCart = user.kira_score.active_cart;
                  const wordsCount = rawText.trim().split(/\s+/).length;
                  const isAddressPattern = /\d+/.test(rawText) || /\b(calle|carrera|cll|cra|diag|diagonal|trans|transversal|av|avenida|norte|sur|este|oeste)\b/i.test(rawText);

                  if (activeCart && wordsCount >= 2 && isAddressPattern) {
                    skipStateMachine = true;

                    let lat = 4.6976;
                    let lng = -74.0617;
                    let formattedAddress = rawText;
                    let isAddressReal = true;

                    try {
                      const geocoded = await geocodeAddress(rawText);
                      if (geocoded.success) {
                        lat = geocoded.lat;
                        lng = geocoded.lng;
                        formattedAddress = geocoded.formattedAddress;
                      } else {
                        isAddressReal = false;
                      }
                    } catch (geocodeErr) {
                      console.error("❌ Error de red/sistema en geocodeAddress (texto):", geocodeErr.message);
                    }

                    if (!isAddressReal) {
                      const errorMsg = `❌ No logramos ubicar la dirección *"${rawText}"*. Por favor, asegúrate de escribir tu dirección completa con calle y número o confírmala en el botón de abajo.`;
                      await this.sendWhatsAppMessage(phone_number_id, from, errorMsg);
                      await this.sendDeliveryFlow(phone_number_id, from, activeCart.listText, activeCart.subtotal);
                      return;
                    }

                    // Guardar los datos en el checkout temporal
                    user.kira_score.temp_checkout = {
                      customer_name: waName,
                      shipping_address: formattedAddress,
                      latitude: Number(lat),
                      longitude: Number(lng),
                      shipping_notes: "",
                      active_cart: {
                        items: activeCart.items,
                        subtotal: activeCart.subtotal,
                        listText: activeCart.listText
                      }
                    };

                    const cleanAddress = rawText.toLowerCase();
                    const hasApartmentInfo = /\b(apt|apto|apartamento|dep|depto|casa\s*\d+|casa\s*[a-z])\b/i.test(cleanAddress);

                    if (hasApartmentInfo) {
                      user.kira_score.checkout_state = "AWAITING_SIMPLE_CONFIRMATION";
                      await strapi.entityService.update("plugin::users-permissions.user", user.id, {
                        data: { kira_score: user.kira_score }
                      });
                      await this.sendHousingConfirmation(phone_number_id, from, formattedAddress, true);
                    } else {
                      user.kira_score.checkout_state = "AWAITING_HOUSING_TYPE";
                      await strapi.entityService.update("plugin::users-permissions.user", user.id, {
                        data: { kira_score: user.kira_score }
                      });
                      await this.sendHousingConfirmation(phone_number_id, from, formattedAddress, false);
                    }

                    systemInteractiveResponse = `📍 Dirección geocodificada (texto): ${formattedAddress}. Esperando confirmación del cliente en chat.`;
                    isSystemInteractive = true;
                  }
                } else if (checkoutState === "AWAITING_SIMPLE_CONFIRMATION") {
                  const temp = user.kira_score.temp_checkout;
                  if (buttonId === "btn_si" || msgText.includes("si") || msgText.includes("sí") || msgText === "1") {
                    if (!temp) {
                      throw new Error("No se encontraron detalles temporales del checkout.");
                    }

                    let deliveryCost = 10000;
                    try {
                      const cabifyResult = await strapi
                        .service("api::cabify-delivery.cabify-delivery")
                        .getPriceEstimate({
                          dropoff_location: { lat: temp.latitude, lon: temp.longitude },
                          dimensions: { height: 10, length: 10, width: 10, unit: "cm" },
                          weight: { value: 1000, unit: "g" },
                        });
                      if (cabifyResult?.deliveries?.[0]?.estimation?.price?.amount) {
                        deliveryCost = cabifyResult.deliveries[0].estimation.price.amount;
                      }
                    } catch (cabifyErr) {
                      console.error("❌ Error consultando Cabify:", cabifyErr.message);
                    }

                    const totalAmount = temp.active_cart.subtotal + deliveryCost;
                    const ref = `WA_${Date.now()}`;

                    const newOrder = await strapi.entityService.create("api::order.order", {
                      data: {
                        whatsapp_id: String(from),
                        customer_name: temp.customer_name,
                        total_amount: Number(totalAmount),
                        wompi_reference: ref,
                        source: "whatsapp",
                        items: temp.active_cart.items,
                        payment_method: "CARD",
                        shipping_address: temp.shipping_address,
                        shipping_latitude: Number(temp.latitude),
                        shipping_longitude: Number(temp.longitude),
                        shipping_notes: temp.shipping_notes || "",
                        users_permissions_users: [user.id],
                        publishedAt: new Date()
                      }
                    });

                    user.kira_score.checkout_state = null;
                    user.kira_score.active_cart = null;
                    user.kira_score.temp_checkout = null;
                    await strapi.entityService.update("plugin::users-permissions.user", user.id, {
                      data: { kira_score: user.kira_score }
                    });

                    const checkoutUrl = getWompiCheckoutUrl(totalAmount, ref);
                    systemInteractiveResponse = `¡Pedido confirmado! Enlace de pago enviado.`;
                    isSystemInteractive = true;

                    setImmediate(async () => {
                      await this.sendWompiPaymentLink(
                        phone_number_id,
                        from,
                        newOrder.id,
                        temp.active_cart.listText,
                        deliveryCost,
                        totalAmount,
                        temp.shipping_address,
                        temp.shipping_notes,
                        checkoutUrl
                      );
                    });
                  } else if (buttonId === "btn_corregir" || msgText.includes("corregir") || msgText.includes("no") || msgText === "2") {
                    const activeCart = user.kira_score.active_cart;
                    user.kira_score.checkout_state = "AWAITING_FLOW_SUBMISSION";
                    await strapi.entityService.update("plugin::users-permissions.user", user.id, {
                      data: { kira_score: user.kira_score }
                    });

                    systemInteractiveResponse = `¡Entendido! Vamos a corregir tus datos de entrega en el formulario de abajo.`;
                    isSystemInteractive = true;

                    setImmediate(async () => {
                      await this.sendWhatsAppMessage(phone_number_id, from, systemInteractiveResponse);
                      await this.sendDeliveryFlow(phone_number_id, from, activeCart.listText, activeCart.subtotal);
                    });
                  } else {
                    systemInteractiveResponse = `Por favor confirma si tu dirección es correcta presionando los botones (*Sí* o *Corregir*).`;
                    isSystemInteractive = true;
                    setImmediate(async () => {
                      await this.sendWhatsAppMessage(phone_number_id, from, systemInteractiveResponse);
                    });
                  }
                } else if (checkoutState === "AWAITING_HOUSING_TYPE") {
                  const temp = user.kira_score.temp_checkout;
                  if (buttonId === "btn_casa" || msgText.includes("casa") || msgText === "1") {
                    if (!temp) {
                      throw new Error("No se encontraron detalles temporales del checkout.");
                    }

                    let deliveryCost = 10000;
                    try {
                      const cabifyResult = await strapi
                        .service("api::cabify-delivery.cabify-delivery")
                        .getPriceEstimate({
                          dropoff_location: { lat: temp.latitude, lon: temp.longitude },
                          dimensions: { height: 10, length: 10, width: 10, unit: "cm" },
                          weight: { value: 1000, unit: "g" },
                        });
                      if (cabifyResult?.deliveries?.[0]?.estimation?.price?.amount) {
                        deliveryCost = cabifyResult.deliveries[0].estimation.price.amount;
                      }
                    } catch (cabifyErr) {
                      console.error("❌ Error consultando Cabify:", cabifyErr.message);
                    }

                    const totalAmount = temp.active_cart.subtotal + deliveryCost;
                    const ref = `WA_${Date.now()}`;

                    const newOrder = await strapi.entityService.create("api::order.order", {
                      data: {
                        whatsapp_id: String(from),
                        customer_name: temp.customer_name,
                        total_amount: Number(totalAmount),
                        wompi_reference: ref,
                        source: "whatsapp",
                        items: temp.active_cart.items,
                        payment_method: "CARD",
                        shipping_address: temp.shipping_address,
                        shipping_latitude: Number(temp.latitude),
                        shipping_longitude: Number(temp.longitude),
                        shipping_notes: temp.shipping_notes || "",
                        users_permissions_users: [user.id],
                        publishedAt: new Date()
                      }
                    });

                    user.kira_score.checkout_state = null;
                    user.kira_score.active_cart = null;
                    user.kira_score.temp_checkout = null;
                    await strapi.entityService.update("plugin::users-permissions.user", user.id, {
                      data: { kira_score: user.kira_score }
                    });

                    const checkoutUrl = getWompiCheckoutUrl(totalAmount, ref);
                    systemInteractiveResponse = `¡Pedido confirmado! Enlace de pago enviado.`;
                    isSystemInteractive = true;

                    setImmediate(async () => {
                      await this.sendWompiPaymentLink(
                        phone_number_id,
                        from,
                        newOrder.id,
                        temp.active_cart.listText,
                        deliveryCost,
                        totalAmount,
                        temp.shipping_address,
                        temp.shipping_notes,
                        checkoutUrl
                      );
                    });
                  } else if (buttonId === "btn_apto" || msgText.includes("apartamento") || msgText.includes("apto") || msgText === "2") {
                    user.kira_score.checkout_state = "AWAITING_APARTMENT_DETAILS";
                    await strapi.entityService.update("plugin::users-permissions.user", user.id, {
                      data: { kira_score: user.kira_score }
                    });

                    systemInteractiveResponse = `🏢 Entendido. Por favor, escribe aquí tu número de torre, apartamento o interior (ejemplo: **Torre 3, Apto 502**):`;
                    isSystemInteractive = true;

                    setImmediate(async () => {
                      await this.sendWhatsAppMessage(phone_number_id, from, systemInteractiveResponse);
                    });
                  } else if (buttonId === "btn_corregir" || msgText.includes("corregir") || msgText === "3") {
                    const activeCart = user.kira_score.active_cart;
                    user.kira_score.checkout_state = "AWAITING_FLOW_SUBMISSION";
                    await strapi.entityService.update("plugin::users-permissions.user", user.id, {
                      data: { kira_score: user.kira_score }
                    });

                    systemInteractiveResponse = `¡Entendido! Vamos a corregir tus datos de entrega en el formulario de abajo.`;
                    isSystemInteractive = true;

                    setImmediate(async () => {
                      await this.sendWhatsAppMessage(phone_number_id, from, systemInteractiveResponse);
                      await this.sendDeliveryFlow(phone_number_id, from, activeCart.listText, activeCart.subtotal);
                    });
                  } else {
                    systemInteractiveResponse = `Por favor, responde seleccionando uno de los botones (*Casa*, *Apartamento*, *Corregir*) o escribe tu respuesta directamente.`;
                    isSystemInteractive = true;
                    setImmediate(async () => {
                      await this.sendWhatsAppMessage(phone_number_id, from, systemInteractiveResponse);
                    });
                  }
                } else if (checkoutState === "AWAITING_APARTMENT_DETAILS") {
                  const temp = user.kira_score.temp_checkout;
                  if (!temp) {
                    throw new Error("No se encontraron detalles temporales del checkout.");
                  }

                  const apartmentDetails = rawText.trim();
                  const finalNotes = temp.shipping_notes 
                    ? `${temp.shipping_notes} | Apto/Torre: ${apartmentDetails}`
                    : `Apto/Torre: ${apartmentDetails}`;

                  let deliveryCost = 10000;
                  try {
                    const cabifyResult = await strapi
                      .service("api::cabify-delivery.cabify-delivery")
                      .getPriceEstimate({
                        dropoff_location: { lat: temp.latitude, lon: temp.longitude },
                        dimensions: { height: 10, length: 10, width: 10, unit: "cm" },
                        weight: { value: 1000, unit: "g" },
                      });
                    if (cabifyResult?.deliveries?.[0]?.estimation?.price?.amount) {
                      deliveryCost = cabifyResult.deliveries[0].estimation.price.amount;
                    }
                  } catch (cabifyErr) {
                    console.error("❌ Error consultando Cabify:", cabifyErr.message);
                  }

                  const totalAmount = temp.active_cart.subtotal + deliveryCost;
                  const ref = `WA_${Date.now()}`;

                  const newOrder = await strapi.entityService.create("api::order.order", {
                    data: {
                      whatsapp_id: String(from),
                      customer_name: temp.customer_name,
                      total_amount: Number(totalAmount),
                      wompi_reference: ref,
                      source: "whatsapp",
                      items: temp.active_cart.items,
                      payment_method: "CARD",
                      shipping_address: temp.shipping_address,
                      shipping_latitude: Number(temp.latitude),
                      shipping_longitude: Number(temp.longitude),
                      shipping_notes: finalNotes,
                      users_permissions_users: [user.id],
                      publishedAt: new Date()
                    }
                  });

                  user.kira_score.checkout_state = null;
                  user.kira_score.active_cart = null;
                  user.kira_score.temp_checkout = null;
                  await strapi.entityService.update("plugin::users-permissions.user", user.id, {
                    data: { kira_score: user.kira_score }
                  });

                  const checkoutUrl = getWompiCheckoutUrl(totalAmount, ref);
                  systemInteractiveResponse = `¡Pedido confirmado! Enlace de pago enviado.`;
                  isSystemInteractive = true;

                  setImmediate(async () => {
                    await this.sendWompiPaymentLink(
                      phone_number_id,
                      from,
                      newOrder.id,
                      temp.active_cart.listText,
                      deliveryCost,
                      totalAmount,
                      temp.shipping_address,
                      finalNotes,
                      checkoutUrl
                    );
                  });
                }
              }


              const textoBotonRegistro = "registrarme aquí";

              const vieneDeWeb = msgText.includes(
                "acabo de registrarme como miembro fundador de koky desde la web",
              );

              if (
                (msgText === textoBotonRegistro || vieneDeWeb) &&
                !user.is_founder
              ) {
                user = await strapi.entityService.update(
                  "plugin::users-permissions.user",

                  user.id,

                  {
                    data: { is_founder: true, whatsapp_id: from },
                  },
                );
              }

              const chatMsg = await strapi.entityService.create("api::chat.chat", {
                data: {
                  sender: from,

                  message: rawText,

                  timestamp: new Date(),

                  publishedAt: new Date(),

                  users_permissions_user: user.id,
                },
              });

              if (mediaAttachmentId) {
                setImmediate(async () => {
                  try {
                    const mediaInfo = await downloadWhatsAppMedia(mediaAttachmentId);
                    await saveAndUploadToStrapi(
                      mediaInfo.buffer,
                      mediaInfo.mimeType,
                      mediaInfo.fileName,
                      chatMsg.id
                    );
                    if (strapi["io"]) {
                      strapi["io"].emit("new_message", { userId: user.id });
                    }
                  } catch (err) {
                    console.error("❌ Error descargando/subiendo adjunto de WhatsApp:", err.message);
                  }
                });
              }


              if (isSystemInteractive && systemInteractiveResponse) {
                await strapi.entityService.create("api::chat.chat", {
                  data: {
                    sender: "Kira",

                    message: systemInteractiveResponse,

                    timestamp: new Date(),

                    publishedAt: new Date(),

                    users_permissions_user: user.id,
                  },
                });

                if (strapi["io"]) {
                  strapi["io"].emit("new_message", { userId: user.id });
                }
              }

              const currentScore = Number(user.kira_score?.curiosity) || 0;

              const newScore = calculateScore(msgText, currentScore);

              user = await strapi.entityService.update(
                "plugin::users-permissions.user",

                user.id,

                {
                  data: {
                    kira_score: {
                      ...user.kira_score,

                      curiosity: Number(newScore),
                    },
                  },
                },
              );

              const userScore = Number(newScore);

              const scoreInfo = { total: userScore };

              // Consultar nuevamente el estado de la base de datos para asegurar el último valor
              const freshDbUser = await strapi.db.query("plugin::users-permissions.user").findOne({
                where: { id: user.id }
              });

              if (freshDbUser && freshDbUser.kira_active !== false && freshDbUser.kira_active !== 0 && freshDbUser.kira_active !== '0' && !isSystemInteractive) {
                const history = await strapi.entityService.findMany(
                  "api::chat.chat",

                  {
                    filters: { users_permissions_user: { id: user.id } },

                    sort: { timestamp: "desc" },

                    limit: 6,
                  },
                );

                const chatContext = history

                  .reverse()

                  .map(
                    (h) =>
                      `${h.sender === from ? "Cliente" : "Kira"}: ${h.message}`,
                  )

                  .join("\n");

                const productList = await ProductService.getProductsContext();

                // Nueva fecha: 15 de julio de 2026
                const fechaLanzamiento = new Date("2026-07-15T00:00:00-05:00");
                const ahora = new Date();

                const diff = fechaLanzamiento - ahora;

                const dias = Math.floor(diff / (1000 * 60 * 60 * 24));

                const horas = Math.floor(
                  (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
                );

                const infoPreventa = `IMPORTANTE: Estamos en preventa de Miembros Fundadores. Quedan exactamente ${dias} días y ${horas} horas para cerrar inscripciones.`;

                const { rulesStr, faqsStr } = await getDynamicPromptsData();
                const orderContext = await getOrderContextForUser(from, user);

                const systemPrompt = KiraPrompts.PROMPT_WA(
                  waName,
                  user.is_founder,
                  chatContext,
                  rawText,
                  scoreInfo,
                  productList,
                  infoPreventa,
                  rulesStr,
                  faqsStr,
                  orderContext
                );

                const result = await model.generateContent(systemPrompt);

                const aiResponse = result.response.text();
                
                // --- CAPA 2: Interceptador de Handoff Humano por IA (WhatsApp) ---
                if (aiResponse.includes("[ACTION: human_takeover]")) {
                  console.log(`⚠️ Gemini solicitó handoff humano para el cliente ${from}. Pausando bot Kira.`);

                  user = await strapi.entityService.update(
                    "plugin::users-permissions.user",
                    user.id,
                    { data: { kira_active: false } }
                  );

                  // NOTIFICACIÓN AL ADMINISTRADOR
                  const adminPhone = process.env.ADMIN_PHONE || "573007979419";
                  if (adminPhone && from !== adminPhone) {
                    const alertMsg = `🚨 *Solicitud de Atención Humana (IA)*\n\nKira determinó que el cliente *${waName}* (${from}) necesita ayuda humana.\n\n*Último mensaje:* "${rawText}"\n\n_Kira ha sido pausada en este chat. Por favor, asume la conversación._`;
                    await this.sendWhatsAppMessage(phone_number_id, adminPhone, alertMsg);
                  }

                  const transferMessage = getTransferMessage();
                  await this.sendWhatsAppMessage(phone_number_id, from, transferMessage);

                  await strapi.entityService.create("api::chat.chat", {
                    data: {
                      sender: "Kira",
                      message: transferMessage,
                      timestamp: new Date(),
                      publishedAt: new Date(),
                      users_permissions_user: user.id,
                    },
                  });

                  if (strapi["io"]) {
                    strapi["io"].emit("new_message", { userId: user.id });
                  }

                  return;
                }

                let messageToSave = aiResponse;

                 // Detectar acción de creación de carrito generada por la IA
                 let actionMatch = aiResponse.match(/\[ACTION:\s*create_cart\s*({.*})\]/s);
                 let parsedCart = null;
                 if (actionMatch) {
                   try {
                     const actionData = JSON.parse(actionMatch[1]);
                     if (actionData.items && actionData.items.length > 0) {
                       parsedCart = await this.buildCartFromNames(actionData.items);
                     }
                   } catch (parseErr) {
                     console.error("❌ Error parseando acción de carrito de la IA:", parseErr.message);
                   }
                   messageToSave = aiResponse.replace(/\[ACTION:\s*create_cart\s*({.*})\]/gs, "").trim();
                 }

                if (parsedCart) {
                  user.kira_score = {
                    ...user.kira_score,
                    active_cart: parsedCart,
                    checkout_state: "AWAITING_FLOW_SUBMISSION"
                  };
                  await strapi.entityService.update("plugin::users-permissions.user", user.id, {
                    data: { kira_score: user.kira_score }
                  });
                }

                const quiereEntrarYa =
                  msgText.includes("fundador") ||
                  msgText.includes("registrar") ||
                  msgText.includes("miembro") ||
                  msgText.includes("invitación") ||
                  msgText.includes("unirme");

                const kiraInvita =
                  aiResponse.toLowerCase().includes("invit") ||
                  aiResponse.toLowerCase().includes("video") ||
                  aiResponse.toLowerCase().includes("fundador");

                if (
                  false // Desactivado permanentemente: ya finalizó la preventa de Miembro Fundador
                ) {
                  messageToSave =
                    "📋 [Invitación enviada: Plantilla de Miembro Fundador]";

                  await axios({
                    method: "POST",

                    url: `https://graph.facebook.com/v21.0/${phone_number_id}/messages`,

                    data: {
                      messaging_product: "whatsapp",

                      to: from,

                      type: "template",

                      template: {
                        name: "invitation",

                        language: { code: "es" },

                        components: [
                          {
                            type: "header",

                            parameters: [
                              {
                                type: "video",

                                video: {
                                  link: "https://storage.googleapis.com/koky_food/KiraInvitation2.5.mp4",
                                },
                              },
                            ],
                          },
                        ],
                      },
                    },

                    headers: {
                      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                    },
                  });
                } else {
                  await axios({
                    method: "POST",

                    url: `https://graph.facebook.com/v21.0/${phone_number_id}/messages`,

                    data: {
                      messaging_product: "whatsapp",

                      to: from,

                      text: { body: messageToSave },
                    },

                    headers: {
                      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                    },
                  });

                  if (parsedCart) {
                    await this.sendDeliveryFlow(phone_number_id, from, parsedCart.listText, parsedCart.subtotal);
                  }
                }

                await strapi.entityService.create("api::chat.chat", {
                  data: {
                    sender: "Kira",

                    message: messageToSave,

                    timestamp: new Date(),

                    publishedAt: new Date(),

                    users_permissions_user: user.id,
                  },
                });

                if (strapi["io"]) {
                  console.log(
                    "📡 Emitiendo evento al socket para el usuario:",
                    user.id,
                  );

                  strapi["io"].emit("new_message", { userId: user.id });
                }
              }
            } catch (error) {
              console.error("❌ Error WA Internal:", error.message);
            }
          }
        }

        // ==========================================

        // ECOISTEMA 2: MESSENGER (FB) E INSTAGRAM

        // ==========================================
        else if (body.object === "page" || body.object === "instagram") {
          const entry = body.entry?.[0];

          const messaging = entry?.messaging?.[0];

          if (
            !messaging ||
            messaging.read ||
            messaging.delivery ||
            messaging.message?.is_echo
          )
            return;

          const from = messaging.sender.id;

          let rawText =
            messaging.message?.text || messaging.postback?.title || "";

          const fbAttachments = messaging.message?.attachments;
          let metaAttachmentsToUpload = [];
          if (fbAttachments && fbAttachments.length > 0) {
            metaAttachmentsToUpload = fbAttachments;
            if (!rawText) {
              const firstAttType = fbAttachments[0].type;
              const typeLabels = {
                image: "📷 Imagen",
                audio: "🎵 Audio",
                video: "🎥 Video",
                file: "📄 Archivo"
              };
              rawText = typeLabels[firstAttType] || "📎 Archivo adjunto";
            }
          }

          const msgText = rawText.toLowerCase().trim();

          try {
            const plataformaKey =
              body.object === "instagram" ? "instagram" : "facebook";

            const profile = await strapi
              .service("api::whatsapp.whatsapp")
              .getUserProfile(from, plataformaKey);

            let metaName = profile?.name || "Cliente";

            const metaAvatar = profile?.avatar_url || null;

            let metaHandle = null;

            if (plataformaKey === "instagram") {
              try {
                const tokenSocial = process.env.MESSENGER_PAGE_TOKEN;

                const urlUser = `https://graph.facebook.com/v21.0/${from}?fields=username&access_token=${tokenSocial}`;

                const resUser = await axios.get(urlUser);

                if (resUser.data?.username) {
                  metaHandle = `@${resUser.data.username}`;
                }
              } catch (e) {
                console.log("⚠️ No se pudo obtener @handle.");
              }
            }

            let user = await this.getOrCreateUser(
              from,
              metaName,
              plataformaKey,
              metaAvatar,
              metaHandle,
            );
            user = await strapi.entityService.update(
              "plugin::users-permissions.user",
              user.id,
              { data: { unread: true } }
            );

            const trimmedText = rawText.trim();

            // Obtener el estado real del usuario de la base de datos para verificar si la IA está activa
            const dbUser = await strapi.db.query("plugin::users-permissions.user").findOne({
              where: { id: user.id }
            });
            const isKiraActive = dbUser && dbUser.kira_active !== false && dbUser.kira_active !== 0 && dbUser.kira_active !== '0';

            // --- CAPA 1: Interceptador de Handoff Humano por Código (Meta) ---
            if (isKiraActive && shouldTakeoverHuman(rawText)) {
              console.log(`⚠️ Cliente Meta ${from} solicita hablar con un humano. Pausando bot Kira.`);

              user = await strapi.entityService.update(
                "plugin::users-permissions.user",
                user.id,
                { data: { kira_active: false } }
              );

              // NOTIFICACIÓN AL ADMINISTRADOR POR WHATSAPP
              const adminPhone = process.env.ADMIN_PHONE || "573007979419";
              const defaultPhoneId = process.env.ID_PHONE_WS || "1037050959491352";
              if (adminPhone && from !== adminPhone) {
                const platformLabel = body.object === "instagram" ? "Instagram" : "Facebook Messenger";
                const alertMsg = `🚨 *Solicitud de Atención Humana (${platformLabel})*\n\nEl cliente *${waName}* (${from}) solicita hablar con un humano en ${platformLabel}.\n\n*Último mensaje:* "${rawText}"\n\n_Kira ha sido pausada en este chat. Por favor, asume la conversación._`;
                await this.sendWhatsAppMessage(defaultPhoneId, adminPhone, alertMsg);
              }

              const chatMsg = await strapi.entityService.create("api::chat.chat", {
                data: {
                  sender: from,
                  message: rawText,
                  timestamp: new Date(),
                  publishedAt: new Date(),
                  users_permissions_user: user.id,
                },
              });

              if (metaAttachmentsToUpload.length > 0) {
                setImmediate(async () => {
                  try {
                    for (const att of metaAttachmentsToUpload) {
                      if (att.payload && att.payload.url) {
                        const mediaInfo = await downloadMetaAttachment(att.payload.url);
                        await saveAndUploadToStrapi(
                          mediaInfo.buffer,
                          mediaInfo.mimeType,
                          mediaInfo.fileName,
                          chatMsg.id
                        );
                      }
                    }
                    if (strapi["io"]) {
                      strapi["io"].emit("new_message", { userId: user.id });
                    }
                  } catch (err) {
                    console.error("❌ Error descargando/subiendo adjunto de Meta:", err.message);
                  }
                });
              }


              const transferMessage = getTransferMessage();

              await axios.post(
                `https://graph.facebook.com/v21.0/me/messages`,
                {
                  recipient: { id: from },
                  message: { text: transferMessage },
                },
                {
                  headers: {
                    Authorization: `Bearer ${process.env.MESSENGER_PAGE_TOKEN}`,
                  },
                }
              );

              await strapi.entityService.create("api::chat.chat", {
                data: {
                  sender: "Kira",
                  message: transferMessage,
                  timestamp: new Date(),
                  publishedAt: new Date(),
                  users_permissions_user: user.id,
                },
              });

              if (strapi["io"]) {
                strapi["io"].emit("new_message", { userId: user.id });
              }

              return;
            }

            // Flujo de registro por número telefónico internacional (+...) recibido por redes sociales

            if (trimmedText.startsWith("+")) {
              try {
                const phoneNumber = phoneUtil.parseAndKeepRawInput(trimmedText);

                if (phoneUtil.isValidNumber(phoneNumber)) {
                  const formattedPhone = phoneUtil.format(phoneNumber, 1);

                  if (!user.is_founder) {
                    user = await strapi.entityService.update(
                      "plugin::users-permissions.user",

                      user.id,

                      {
                        data: { is_founder: true, whatsapp_id: formattedPhone },
                      },
                    );

                    const confirmMsg =
                      "¡Listo! Ya eres Miembro Fundador de Koky 🎉 ese delivery gratis al mes es tuyo de por vida 👀";

                    await axios.post(
                      `https://graph.facebook.com/v21.0/me/messages`,

                      {
                        recipient: { id: from },

                        message: { text: confirmMsg },
                      },

                      {
                        headers: {
                          Authorization: `Bearer ${process.env.MESSENGER_PAGE_TOKEN}`,
                        },
                      },
                    );

                    await strapi.entityService.create("api::chat.chat", {
                      data: {
                        sender: "Kira",

                        message: confirmMsg,

                        timestamp: new Date(),

                        publishedAt: new Date(),

                        users_permissions_user: user.id,
                      },
                    });

                    if (strapi["io"]) {
                      console.log(
                        "📡 Emitiendo evento al socket para el usuario:",
                        user.id,
                      );

                      strapi["io"].emit("new_message", { userId: user.id });
                    }

                    return;
                  } else {
                    const yaEsMiembroMsg =
                      "ese número ya está registrado como Miembro Fundador 🥦 tu delivery gratis ya es tuyo.";

                    await axios.post(
                      `https://graph.facebook.com/v21.0/me/messages`,

                      {
                        recipient: { id: from },

                        message: { text: yaEsMiembroMsg },
                      },

                      {
                        headers: {
                          Authorization: `Bearer ${process.env.MESSENGER_PAGE_TOKEN}`,
                        },
                      },
                    );

                    await strapi.entityService.create("api::chat.chat", {
                      data: {
                        sender: "Kira",

                        message: yaEsMiembroMsg,

                        timestamp: new Date(),

                        publishedAt: new Date(),

                        users_permissions_user: user.id,
                      },
                    });

                    if (strapi["io"]) {
                      console.log(
                        "📡 Emitiendo evento al socket para el usuario:",
                        user.id,
                      );

                      strapi["io"].emit("new_message", { userId: user.id });
                    }

                    return;
                  }
                }
              } catch (e) {
                console.log("🚫 Error formato.");
              }
            }

            const chatMsg = await strapi.entityService.create("api::chat.chat", {
              data: {
                sender: from,

                message: rawText,

                timestamp: new Date(),

                publishedAt: new Date(),

                users_permissions_user: user.id,
              },
            });

            if (metaAttachmentsToUpload.length > 0) {
              setImmediate(async () => {
                try {
                  for (const att of metaAttachmentsToUpload) {
                    if (att.payload && att.payload.url) {
                      const mediaInfo = await downloadMetaAttachment(att.payload.url);
                      await saveAndUploadToStrapi(
                        mediaInfo.buffer,
                        mediaInfo.mimeType,
                        mediaInfo.fileName,
                        chatMsg.id
                      );
                    }
                  }
                  if (strapi["io"]) {
                    strapi["io"].emit("new_message", { userId: user.id });
                  }
                } catch (err) {
                  console.error("❌ Error descargando/subiendo adjunto de Meta:", err.message);
                }
              });
            }


            const metaScoreActual = Number(user.kira_score?.curiosity) || 0;

            const metaScoreNuevo = calculateScore(msgText, metaScoreActual);

            user = await strapi.entityService.update(
              "plugin::users-permissions.user",

              user.id,

              {
                data: {
                  kira_score: {
                    ...user.kira_score,

                    curiosity: Number(metaScoreNuevo),
                  },
                },
              },
            );

            const userScore = Number(metaScoreNuevo);

            const scoreInfo = { total: userScore };

            // Consultar nuevamente el estado de la base de datos para asegurar el último valor
            const freshDbUser = await strapi.db.query("plugin::users-permissions.user").findOne({
              where: { id: user.id }
            });

            if (freshDbUser && freshDbUser.kira_active !== false && freshDbUser.kira_active !== 0 && freshDbUser.kira_active !== '0') {
              const history = await strapi.entityService.findMany(
                "api::chat.chat",

                {
                  filters: { users_permissions_user: { id: user.id } },

                  sort: { timestamp: "desc" },

                  limit: 6,
                },
              );

              const chatContext = history

                .reverse()

                .map(
                  (h) =>
                    `${h.sender === from ? "Cliente" : "Kira"}: ${h.message}`,
                )

                .join("\n");

              const productListMeta = await ProductService.getProductsContext();

              const fechaLanzamientoMeta = new Date(
                "2026-06-29T00:00:00-05:00",
              );

              const ahoraMeta = new Date();

              const diffMeta = fechaLanzamientoMeta - ahoraMeta;

              const diasMeta = Math.floor(diffMeta / (1000 * 60 * 60 * 24));

              const horasMeta = Math.floor(
                (diffMeta % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
              );

              const infoPreventaMeta = `IMPORTANTE: Quedan exactamente ${diasMeta} días y ${horasMeta} horas de preventa.`;

              const { rulesStr, faqsStr } = await getDynamicPromptsData();
              const orderContextMeta = await getOrderContextForUser(from, user);

              const systemPrompt = KiraPrompts.PROMPT_META(
                user.username,
                user.is_founder,
                chatContext,
                rawText,
                scoreInfo,
                productListMeta,
                infoPreventaMeta,
                rulesStr,
                faqsStr,
                orderContextMeta
              );

              const result = await model.generateContent(systemPrompt);

              const aiResponse = result.response.text();

              // --- CAPA 2: Interceptador de Handoff Humano por IA (Meta) ---
              if (aiResponse.includes("[ACTION: human_takeover]")) {
                console.log(`⚠️ Gemini solicitó handoff humano para el cliente Meta ${from}. Pausando bot Kira.`);

                user = await strapi.entityService.update(
                  "plugin::users-permissions.user",
                  user.id,
                  { data: { kira_active: false } }
                );

                // NOTIFICACIÓN AL ADMINISTRADOR POR WHATSAPP
                const adminPhone = process.env.ADMIN_PHONE || "573007979419";
                const defaultPhoneId = process.env.ID_PHONE_WS || "1037050959491352";
                if (adminPhone && from !== adminPhone) {
                  const platformLabel = body.object === "instagram" ? "Instagram" : "Facebook Messenger";
                  const alertMsg = `🚨 *Solicitud de Atención Humana - IA (${platformLabel})*\n\nKira determinó que el cliente *${waName}* (${from}) en ${platformLabel} necesita ayuda humana.\n\n*Último mensaje:* "${rawText}"\n\n_Kira ha sido pausada en este chat. Por favor, asume la conversación._`;
                  await this.sendWhatsAppMessage(defaultPhoneId, adminPhone, alertMsg);
                }

                const transferMessage = getTransferMessage();

                await axios.post(
                  `https://graph.facebook.com/v21.0/me/messages`,
                  {
                    recipient: { id: from },
                    message: { text: transferMessage },
                  },
                  {
                    headers: {
                      Authorization: `Bearer ${process.env.MESSENGER_PAGE_TOKEN}`,
                    },
                  }
                );

                await strapi.entityService.create("api::chat.chat", {
                  data: {
                    sender: "Kira",
                    message: transferMessage,
                    timestamp: new Date(),
                    publishedAt: new Date(),
                    users_permissions_user: user.id,
                  },
                });

                if (strapi["io"]) {
                  strapi["io"].emit("new_message", { userId: user.id });
                }

                return;
              }

              await axios.post(
                `https://graph.facebook.com/v21.0/me/messages`,

                {
                  recipient: { id: from },

                  message: { text: aiResponse },
                },

                {
                  headers: {
                    Authorization: `Bearer ${process.env.MESSENGER_PAGE_TOKEN}`,
                  },
                },
              );

              await strapi.entityService.create("api::chat.chat", {
                data: {
                  sender: "Kira",

                  message: aiResponse,

                  timestamp: new Date(),

                  publishedAt: new Date(),

                  users_permissions_user: user.id,
                },
              });

              if (strapi["io"]) {
                console.log(
                  "📡 Emitiendo evento al socket para el usuario:",
                  user.id,
                );

                strapi["io"].emit("new_message", { userId: user.id });
              }
            }
          } catch (e) {
            console.error("❌ Error Proceso Redes:", e.message);
          }
        }
      } catch (globalError) {
        console.error("❌ Error Crítico Webhook:", globalError.message);
      }
    });
  },

  async improveMessage(ctx) {
    try {
      const { text } = ctx.request.body;
      if (!text || !text.trim()) {
        return ctx.badRequest("El texto no puede estar vacío");
      }

      const prompt = `Eres un asistente de redacción experto para Koky (ventas de tofu artesanal). 
Tu tarea es corregir la ortografía, mejorar la gramática y optimizar la redacción del siguiente borrador escrito por un asesor de soporte humano.
El mensaje debe sonar muy profesional, amable y cálido, pero manteniendo el mensaje original del asesor y su intención.

Borrador del asesor:
"${text}"

Devuelve ÚNICAMENTE el mensaje mejorado final. No incluyas explicaciones, no incluyas introducciones como "Aquí tienes la corrección", no uses comillas alrededor de la respuesta final y no agregues notas adicionales.`;

      const result = await model.generateContent(prompt);
      const improvedText = result.response.text().trim();

      return { improvedText };
    } catch (error) {
      console.error("❌ Error al mejorar el mensaje con Gemini:", error);
      return ctx.internalServerError("Error al procesar el mensaje con Gemini");
    }
  },
};
