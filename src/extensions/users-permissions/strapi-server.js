'use strict';

module.exports = (plugin) => {
  // Guardamos el método original de actualización si lo necesitamos, 
  // pero lo sobrescribimos para usar entityService y permitir actualizar kira_active y unread.
  plugin.controllers.user.update = async (ctx) => {
    const { id } = ctx.params;

    // Verificar si el usuario existe
    const user = await strapi.entityService.findOne('plugin::users-permissions.user', id);
    if (!user) {
      return ctx.notFound('User not found');
    }

    // Actualizar todos los campos enviados en el body usando el Entity Service
    // Esto permite que campos personalizados como kira_active y unread se guarden correctamente.
    // Soporta payloads planos (e.g. { kira_active: false }) y payloads anidados en 'data' (e.g. { data: { kira_active: false } })
    const updateData = ctx.request.body.data !== undefined ? ctx.request.body.data : ctx.request.body;
    const updatedUser = await strapi.entityService.update('plugin::users-permissions.user', id, {
      data: updateData,
    });

    // Sanitizar los datos del usuario antes de responder (evita exponer la contraseña hash, etc.)
    const schema = strapi.getModel('plugin::users-permissions.user');
    const { auth } = ctx.state || {};
    const sanitizedUser = await strapi.contentAPI.sanitize.output(updatedUser, schema, { auth });
    
    ctx.body = sanitizedUser;
  };

  return plugin;
};
