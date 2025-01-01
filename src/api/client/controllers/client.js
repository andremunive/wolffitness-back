"use strict";

/**
 * client controller
 */

// @ts-ignore
const { createCoreController } = require("@strapi/strapi").factories;

// module.exports = createCoreController("api::client.client");
module.exports = createCoreController("api::client.client", ({ strapi }) => ({
  // async find(ctx) {
  //   // Aplica un filtro para que solo devuelva clientes con visible: true
  //   const clients = await strapi.entityService.findMany("api::client.client", {
  //     filters: { visible: true }, // Filtra por el atributo visible
  //     populate: "*", // Ajusta esto si necesitas incluir relaciones
  //   });

  //   return this.transformResponse(clients);
  // },

  async findByTrainer(ctx) {
    const { name } = ctx.params; // Obtén el nombre del entrenador del query param
    const { page, pageSize } = ctx.query;
    const pageNum = parseInt(page, 10);
    const pageSizeNum = parseInt(pageSize, 10);
    // Filtra los clientes según el atributo trainer
    const start = (pageNum - 1) * pageSizeNum;
    const limit = pageSizeNum;

    const total = await strapi.entityService.count("api::client.client", {
      filters: { trainer: name, visible: true },
    });

    const clients = await strapi.entityService.findMany("api::client.client", {
      filters: { trainer: name, visible: true },
      populate: "*", // Ajusta el populate según sea necesario
      sort: { endDate: "desc" },
      start: start, // Offset para paginación
      limit: limit, // Tamaño de la página
    });
    return {
      data: this.transformResponse(clients),
      meta: {
        pagination: {
          page: pageNum,
          pageSize: pageSizeNum,
          total: total,
          pageCount: Math.ceil(total / pageSizeNum),
        },
      },
    };
  },
}));
