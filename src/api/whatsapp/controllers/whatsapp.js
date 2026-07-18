// @ts-nocheck

"use strict";

const axios = require("axios");

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

async function geocodeAddress(address) {
  const apiKey = process.env.G_MAPS_KEY;
  if (!apiKey) {
    throw new Error("G_MAPS_KEY no está configurada en las variables de entorno.");
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

  if (response.data.status !== "OK" || !response.data.results.length) {
    throw new Error(`No se pudo geocodificar la dirección: ${response.data.status}`);
  }

  const location = response.data.results[0].geometry.location;
  const formattedAddress = response.data.results[0].formatted_address;
  return {
    lat: location.lat,
    lng: location.lng,
    formattedAddress: formattedAddress
  };
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
    messageBody += `🛵 **Envío (Cabify):** $${deliveryCost.toLocaleString('es-CO')} COP\n`;
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
                let geocodeSuccess = true;

                try {
                  const geocoded = await geocodeAddress(address);
                  lat = geocoded.lat;
                  lng = geocoded.lng;
                  formattedAddress = geocoded.formattedAddress;
                } catch (geocodeErr) {
                  console.warn("⚠️ Geocoding failed for flow address. Using fallback coordinates.");
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
                      messageBody += `🛵 **Envío (Cabify):** $${deliveryCost.toLocaleString('es-CO')} COP\n`;
                      messageBody += `💰 **Total Final:** $${totalAmount.toLocaleString('es-CO')} COP\n\n`;
                      messageBody += `📍 **Dirección:** ${selected.address}\n\n`;

                       const checkoutUrl = `https://checkout.wompi.co/p/?public-key=${process.env.WOMPI_PUBLIC_KEY || 'pub_test_kB5ENAJ1QA4hPWZYlcrehcyjFrhQyUdq'}&currency=COP&amount-in-cents=${Math.round(totalAmount * 100)}&reference=${ref}&redirect-url=https://wa.me/573019447660`;
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

                    try {
                      const geocoded = await geocodeAddress(rawText);
                      lat = geocoded.lat;
                      lng = geocoded.lng;
                      formattedAddress = geocoded.formattedAddress;
                    } catch (geocodeErr) {
                      console.warn("⚠️ Geocoding failed for text address. Using fallback coordinates.");
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

                    const checkoutUrl = `https://checkout.wompi.co/p/?public-key=${process.env.WOMPI_PUBLIC_KEY || 'pub_test_kB5ENAJ1QA4hPWZYlcrehcyjFrhQyUdq'}&currency=COP&amount-in-cents=${Math.round(totalAmount * 100)}&reference=${ref}&redirect-url=https://wa.me/573019447660`;
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

                    const checkoutUrl = `https://checkout.wompi.co/p/?public-key=${process.env.WOMPI_PUBLIC_KEY || 'pub_test_kB5ENAJ1QA4hPWZYlcrehcyjFrhQyUdq'}&currency=COP&amount-in-cents=${Math.round(totalAmount * 100)}&reference=${ref}&redirect-url=https://wa.me/573019447660`;
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

                  const checkoutUrl = `https://checkout.wompi.co/p/?public-key=${process.env.WOMPI_PUBLIC_KEY || 'pub_test_kB5ENAJ1QA4hPWZYlcrehcyjFrhQyUdq'}&currency=COP&amount-in-cents=${Math.round(totalAmount * 100)}&reference=${ref}&redirect-url=https://wa.me/573019447660`;
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

              await strapi.entityService.create("api::chat.chat", {
                data: {
                  sender: from,

                  message: rawText,

                  timestamp: new Date(),

                  publishedAt: new Date(),

                  users_permissions_user: user.id,
                },
              });

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

              if (user.kira_active !== false && !isSystemInteractive) {
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

                const systemPrompt = KiraPrompts.PROMPT_WA(
                  waName,

                  user.is_founder,

                  chatContext,

                  rawText,

                  scoreInfo,

                  productList,

                  infoPreventa,
                );

                const result = await model.generateContent(systemPrompt);

                const aiResponse = result.response.text();
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
                  !user.is_founder &&
                  (quiereEntrarYa || kiraInvita || userScore >= 8)
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

          const rawText =
            messaging.message?.text || messaging.postback?.title || "";

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

            await strapi.entityService.create("api::chat.chat", {
              data: {
                sender: from,

                message: rawText,

                timestamp: new Date(),

                publishedAt: new Date(),

                users_permissions_user: user.id,
              },
            });

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

            if (user.kira_active !== false) {
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

              const systemPrompt = KiraPrompts.PROMPT_META(
                user.username,

                user.is_founder,

                chatContext,

                rawText,

                scoreInfo,

                productListMeta,

                infoPreventaMeta,
              );

              const result = await model.generateContent(systemPrompt);

              const aiResponse = result.response.text();

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
};
