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
    const updatedUser = await strapi.entityService.update('plugin::users-permissions.user', id, {
      data: ctx.request.body,
    });

    // Sanitizar los datos del usuario antes de responder (evita exponer la contraseña hash, etc.)
    const sanitizedUser = await strapi.plugins['users-permissions'].services.user.sanitizeUser(updatedUser, ctx);
    
    ctx.body = sanitizedUser;
  };

  return plugin;
};
