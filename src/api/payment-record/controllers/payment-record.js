"use strict";

/**
 * payment-record controller
 */

// @ts-ignore
const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController(
  "api::payment-record.payment-record",
  ({ strapi }) => ({
    async lastThree(ctx) {
      const { clientId } = ctx.params; // Obtén el id del cliente desde los parámetros de la ruta

      const paymentRecords = await strapi.entityService.findMany(
        "api::payment-record.payment-record",
        {
          filters: { client: clientId }, // Filtrar por el cliente
          sort: { createdAt: "desc" }, // Ordenar por fecha de creación (más reciente primero)
          limit: 3, // Limitar a los últimos 3 registros
        }
      );

      return this.transformResponse(paymentRecords);
    },
    async byTrainer(ctx) {
      try {
        const { trainer } = ctx.params;
        const clients = await strapi.entityService.findMany(
          "api::client.client",
          {
            filters: { trainer },
            fields: ["id"], // Solo necesitamos los IDs de los clientes
          }
        );
        if (!clients.length) {
          return ctx.notFound(
            "No se encontraron clientes para este entrenador"
          );
        }

        const clientIds = clients.map((client) => client.id);

        const paymentRecords = await strapi.entityService.findMany(
          "api::payment-record.payment-record",
          {
            filters: {
              client: {
                id: { $in: clientIds }, // Filtrar por IDs de los clientes
              },
            },
            populate: ["client"], // Opcional: incluye los datos del cliente relacionado
          }
        );

        return this.transformResponse(paymentRecords);
      } catch (error) {
        strapi.log.error(error);
        return ctx.internalServerError(
          "Ocurrió un error al obtener los registros de pago"
        );
      }
    },

    async getClientAccountsByTrainer(ctx) {
      try {
        const { trainer, months } = ctx.params;

        // Obtener clientes asociados al entrenador
        const clients = await strapi.entityService.findMany(
          "api::client.client",
          {
            filters: { trainer },
            fields: ["id"], // Solo necesitamos los IDs de los clientes
          }
        );

        if (!clients.length) {
          return ctx.notFound(
            "No se encontraron clientes para este entrenador"
          );
        }

        // Extraer los IDs de los clientes
        const clientIds = clients.map((client) => client.id);

        // Obtener fecha de inicio y fin de los últimos meses
        const now = new Date();
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 2);
        threeMonthsAgo.setDate(1); // Inicio del primer mes

        // Buscar registros de pagos en los últimos meses
        const paymentRecords = await strapi.entityService.findMany(
          "api::payment-record.payment-record",
          {
            filters: {
              client: {
                id: { $in: clientIds }, // Filtrar por clientes
              },
              paymentDate: {
                $gte: threeMonthsAgo.toISOString(), // Desde hace tres meses
                $lte: new Date(
                  now.getFullYear(),
                  now.getMonth() + 1,
                  0
                ).toISOString(), // Hasta el último día del mes actual
              },
            },
          }
        );

        if (!paymentRecords.length) {
          return ctx.notFound(
            "No se encontraron registros de pagos en los últimos meses"
          );
        }

        // Procesar los datos
        const accountSummary = {};

        const calculateBonus = (payments, accumulatedCount) => {
          let bonus = 0;
          let eligibleCount = accumulatedCount; // Clientes válidos acumulados hasta ahora

          payments.forEach((payment) => {
            if (payment.plan === "6 dias" && payment.status === "paid") {
              eligibleCount += 1; // Incrementa el conteo de clientes válidos

              if (eligibleCount > 7) {
                // Solo aplica el bono a partir del octavo cliente
                const amount = parseFloat(payment.amount);
                const discount = payment.hasDiscounted
                  ? parseFloat(payment.discountAmount || 0)
                  : 0;

                if (!payment.hasDiscounted) {
                  // Sin descuento
                  bonus += amount / 2 - 40000;
                } else if (payment.discountReason === "Promocion") {
                  // Descuento tipo "Promocion"
                  bonus += (amount - discount) / 2 - 40000;
                } else if (payment.discountReason === "Personal") {
                  // Descuento tipo "Personal"
                  bonus += amount / 2 - 40000;
                }
              }
            }
          });

          return { bonus, eligibleCount };
        };

        for (let i = 0; i < months; i++) {
          const month = new Date();
          month.setMonth(now.getMonth() - i);
          const year = month.getFullYear();
          const monthNumber = month.getMonth() + 1; // Mes 1-indexado
          const startFirstHalf = new Date(year, monthNumber - 1, 1); // Inicio 1ra quincena
          const endFirstHalf = new Date(year, monthNumber - 1, 15); // Fin 1ra quincena
          const startSecondHalf = new Date(year, monthNumber - 1, 16); // Inicio 2da quincena
          const endSecondHalf = new Date(year, monthNumber, 0); // Fin del mes

          const firstHalfPayments = paymentRecords.filter((payment) => {
            const paymentDate = new Date(payment.paymentDate);
            return paymentDate >= startFirstHalf && paymentDate <= endFirstHalf;
          });

          const secondHalfPayments = paymentRecords.filter((payment) => {
            const paymentDate = new Date(payment.paymentDate);
            return (
              paymentDate >= startSecondHalf && paymentDate <= endSecondHalf
            );
          });

          const calculateCollected = (payments) => {
            return payments.reduce((sum, payment) => {
              if (payment.status === "pending") {
                return sum; // Ignorar pagos pendientes
              }
              const amount = parseFloat(payment.amount);
              const discount = payment.hasDiscounted
                ? parseFloat(payment.discountAmount || 0)
                : 0;
              const reason = payment.discountReason;

              if (payment.plan === "6 dias") {
                if (payment.hasDiscounted) {
                  if (reason === "Promocion") {
                    return sum + (amount - discount) / 2;
                  } else if (reason === "Personal") {
                    return sum + amount / 2 - discount;
                  }
                }
                return sum + amount / 2;
              } else if (payment.plan === "3 dias") {
                if (payment.hasDiscounted) {
                  if (reason === "Promocion") {
                    return sum + 50000 - discount;
                  } else if (reason === "Personal") {
                    return sum + 50000 - discount;
                  }
                }
                return sum + 50000;
              }

              return sum;
            }, 0);
          };

          const calculateGenerated = (payments) => {
            return payments.reduce((sum, payment) => {
              if (payment.status === "pending") {
                return sum; // Ignorar pagos pendientes
              }

              const amount = parseFloat(payment.amount);
              const discount = payment.hasDiscounted
                ? parseFloat(payment.discountAmount || 0)
                : 0;

              if (payment.hasDiscounted) {
                const reason = payment.discountReason;
                if (reason === "Promocion" || reason === "Personal") {
                  return sum + (amount - discount); // Resta el descuento sin dividir
                }
              }

              return sum + amount; // Suma completa del monto
            }, 0);
          };

          const calculatePendingGenerated = (payments) => {
            return payments.reduce((sum, payment) => {
              if (payment.status === "pending") {
                const amount = parseFloat(payment.amount);
                const discount = payment.hasDiscounted
                  ? parseFloat(payment.discountAmount || 0)
                  : 0;

                if (payment.hasDiscounted) {
                  const reason = payment.discountReason;
                  if (reason === "Promocion" || reason === "Personal") {
                    return sum + (amount - discount); // Resta el descuento sin dividir
                  }
                }
                return sum + amount; // Suma completa del monto
              }
              return sum;
            }, 0);
          };

          const calculatePendingCollected = (payments) => {
            return payments.reduce((sum, payment) => {
              if (payment.status === "pending") {
                const amount = parseFloat(payment.amount);
                const discount = payment.hasDiscounted
                  ? parseFloat(payment.discountAmount || 0)
                  : 0;
                const reason = payment.discountReason;

                if (payment.plan === "6 dias") {
                  if (payment.hasDiscounted) {
                    if (reason === "Promocion") {
                      return sum + (amount - discount) / 2;
                    } else if (reason === "Personal") {
                      return sum + amount / 2 - discount;
                    }
                  }
                  return sum + amount / 2;
                } else if (payment.plan === "3 dias") {
                  if (payment.hasDiscounted) {
                    if (reason === "Promocion") {
                      return sum + 50000 - discount;
                    } else if (reason === "Personal") {
                      return sum + 50000 - discount;
                    }
                  }
                  return sum + 50000;
                }

                return sum;
              }
              return sum;
            }, 0);
          };

          // Calcular el bono para la primera quincena
          const firstHalfBonusData = calculateBonus(firstHalfPayments, 0);
          const firstHalfBonus = firstHalfBonusData.bonus;
          const accumulatedCountFirstHalf = firstHalfBonusData.eligibleCount;

          // Calcular el bono para la segunda quincena, acumulando los clientes de la primera
          const secondHalfBonusData = calculateBonus(
            secondHalfPayments,
            accumulatedCountFirstHalf
          );
          const secondHalfBonus = secondHalfBonusData.bonus;

          accountSummary[`${year}-${monthNumber}`] = {
            firstHalf: {
              totalCollected: calculateCollected(firstHalfPayments),
              totalGenerated: calculateGenerated(firstHalfPayments),
              bonus: firstHalfBonus,
              pendingGenerated: calculatePendingGenerated(firstHalfPayments), // Total generado en estado pending
              pendingCollected: calculatePendingCollected(firstHalfPayments), // Total recolectado en estado pending
            },
            secondHalf: {
              totalCollected: calculateCollected(secondHalfPayments),
              totalGenerated: calculateGenerated(secondHalfPayments),
              bonus: secondHalfBonus + firstHalfBonus,
              pendingGenerated: calculatePendingGenerated(secondHalfPayments), // Total generado en estado pending
              pendingCollected: calculatePendingCollected(secondHalfPayments), // Total recolectado en estado pending
            },
          };
        }

        // Retornar el resumen
        return this.transformResponse(accountSummary);
      } catch (error) {
        strapi.log.error(error);
        return ctx.internalServerError(
          "Ocurrió un error al procesar la solicitud"
        );
      }
    },

    async getClientCountsByTrainer(ctx) {
      try {
        const { trainer, months } = ctx.params;

        // Obtener clientes asociados al entrenador
        const clients = await strapi.entityService.findMany(
          "api::client.client",
          {
            filters: { trainer },
            fields: ["id"], // Solo necesitamos los IDs de los clientes
          }
        );

        if (!clients.length) {
          return ctx.notFound(
            "No se encontraron clientes para este entrenador"
          );
        }

        // Extraer los IDs de los clientes
        const clientIds = clients.map((client) => client.id);

        // Obtener fecha de inicio y fin de los últimos meses
        const now = new Date();
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - (months - 1));
        threeMonthsAgo.setDate(1); // Inicio del primer mes
        const endOfMonth = new Date();
        endOfMonth.setMonth(endOfMonth.getMonth() + 1, 0); // Día 0 del próximo mes = último día del mes actual
        endOfMonth.setHours(23, 59, 59, 999); // Asegurarse de incluir todo el día

        // Buscar registros de pagos en los últimos meses
        const paymentRecords = await strapi.entityService.findMany(
          "api::payment-record.payment-record",
          {
            filters: {
              client: {
                id: { $in: clientIds }, // Filtrar por clientes
              },
              paymentDate: {
                $gte: threeMonthsAgo.toISOString(), // Desde el inicio de los meses
                $lte: endOfMonth.toISOString(), // Hasta el último día del mes actual
              },
            },
          }
        );

        if (!paymentRecords.length) {
          return ctx.notFound(
            "No se encontraron registros de pagos en los últimos meses"
          );
        }

        // Procesar los datos
        const clientSummary = {};

        const calculatePlanCounts = (payments) => {
          return payments.reduce(
            (counts, payment) => {
              if (payment.plan === "3 dias") {
                if (payment.status === "pending") {
                  counts.pending["3 dias"] += 1;
                } else if (payment.status === "paid") {
                  counts.actives["3 dias"] += 1;
                }
              } else if (payment.plan === "6 dias") {
                if (payment.status === "pending") {
                  counts.pending["6 dias"] += 1;
                } else if (payment.status === "paid") {
                  counts.actives["6 dias"] += 1;
                }
              }
              return counts;
            },
            {
              pending: { "3 dias": 0, "6 dias": 0 },
              actives: { "3 dias": 0, "6 dias": 0 },
            }
          );
        };

        for (let i = 0; i < months; i++) {
          const month = new Date();
          month.setMonth(now.getMonth() - i);
          const year = month.getFullYear();
          const monthNumber = month.getMonth() + 1; // Mes 1-indexado
          const startFirstHalf = new Date(year, monthNumber - 1, 1); // Inicio 1ra quincena
          const endFirstHalf = new Date(year, monthNumber - 1, 15); // Fin 1ra quincena
          const startSecondHalf = new Date(year, monthNumber - 1, 16); // Inicio 2da quincena
          const endSecondHalf = new Date(year, monthNumber, 0); // Fin del mes

          const firstHalfPayments = paymentRecords.filter((payment) => {
            const paymentDate = new Date(payment.paymentDate);
            return paymentDate >= startFirstHalf && paymentDate <= endFirstHalf;
          });

          const secondHalfPayments = paymentRecords.filter((payment) => {
            const paymentDate = new Date(payment.paymentDate);
            return (
              paymentDate >= startSecondHalf && paymentDate <= endSecondHalf
            );
          });

          clientSummary[`${year}-${monthNumber}`] = {
            firstHalf: calculatePlanCounts(firstHalfPayments),
            secondHalf: calculatePlanCounts(secondHalfPayments),
          };
        }

        // Retornar el resumen
        return this.transformResponse(clientSummary);
      } catch (error) {
        strapi.log.error(error);
        return ctx.internalServerError(
          "Ocurrió un error al procesar la solicitud"
        );
      }
    },

    async getClientCountsForAllTrainers(ctx) {
      try {
        const { months } = ctx.params;

        // Obtener todos los entrenadores
        const trainers = await strapi.entityService.findMany(
          "api::trainer.trainer",
          {
            fields: ["name"], // Solo necesitamos los nombres de los entrenadores
          }
        );

        if (!trainers.length) {
          return ctx.notFound(
            "No se encontraron entrenadores en la base de datos"
          );
        }

        const clientSummaries = {};

        // Iterar sobre cada entrenador
        for (const trainer of trainers) {
          const trainerName = trainer.name;

          // Obtener clientes asociados al entrenador
          const clients = await strapi.entityService.findMany(
            "api::client.client",
            {
              filters: { trainer: trainerName },
              fields: ["id"], // Solo necesitamos los IDs de los clientes
            }
          );

          if (!clients.length) {
            clientSummaries[trainerName] = {
              message: "No se encontraron clientes para este entrenador",
            };
            continue;
          }

          // Extraer los IDs de los clientes
          const clientIds = clients.map((client) => client.id);

          // Obtener fecha de inicio y fin de los últimos meses
          const now = new Date();
          const threeMonthsAgo = new Date();
          threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - (months - 1));
          threeMonthsAgo.setDate(1); // Inicio del primer mes
          const endOfMonth = new Date();
          endOfMonth.setMonth(endOfMonth.getMonth() + 1, 0); // Último día del mes actual
          endOfMonth.setHours(23, 59, 59, 999);

          // Buscar registros de pagos en los últimos meses
          const paymentRecords = await strapi.entityService.findMany(
            "api::payment-record.payment-record",
            {
              filters: {
                client: {
                  id: { $in: clientIds }, // Filtrar por clientes
                },
                paymentDate: {
                  $gte: threeMonthsAgo.toISOString(), // Desde el inicio de los meses
                  $lte: endOfMonth.toISOString(), // Hasta el último día del mes actual
                },
              },
            }
          );

          if (!paymentRecords.length) {
            clientSummaries[trainerName] = {
              message:
                "No se encontraron registros de pagos para este entrenador",
            };
            continue;
          }

          // Procesar los datos
          const calculatePlanCounts = (payments) => {
            return payments.reduce(
              (counts, payment) => {
                if (payment.plan === "3 dias") {
                  if (payment.status === "pending") {
                    counts.pending["3 dias"] += 1;
                  } else if (payment.status === "paid") {
                    counts.actives["3 dias"] += 1;
                  }
                } else if (payment.plan === "6 dias") {
                  if (payment.status === "pending") {
                    counts.pending["6 dias"] += 1;
                  } else if (payment.status === "paid") {
                    counts.actives["6 dias"] += 1;
                  }
                }
                return counts;
              },
              {
                pending: { "3 dias": 0, "6 dias": 0 },
                actives: { "3 dias": 0, "6 dias": 0 },
              }
            );
          };

          const clientSummary = {};

          for (let i = 0; i < months; i++) {
            const month = new Date();
            month.setMonth(now.getMonth() - i);
            const year = month.getFullYear();
            const monthNumber = month.getMonth() + 1; // Mes 1-indexado
            const startFirstHalf = new Date(year, monthNumber - 1, 1); // Inicio 1ra quincena
            const endFirstHalf = new Date(year, monthNumber - 1, 15); // Fin 1ra quincena
            const startSecondHalf = new Date(year, monthNumber - 1, 16); // Inicio 2da quincena
            const endSecondHalf = new Date(year, monthNumber, 0); // Fin del mes

            const firstHalfPayments = paymentRecords.filter((payment) => {
              const paymentDate = new Date(payment.paymentDate);
              return (
                paymentDate >= startFirstHalf && paymentDate <= endFirstHalf
              );
            });

            const secondHalfPayments = paymentRecords.filter((payment) => {
              const paymentDate = new Date(payment.paymentDate);
              return (
                paymentDate >= startSecondHalf && paymentDate <= endSecondHalf
              );
            });

            clientSummary[`${year}-${monthNumber}`] = {
              firstHalf: calculatePlanCounts(firstHalfPayments),
              secondHalf: calculatePlanCounts(secondHalfPayments),
            };
          }

          clientSummaries[trainerName] = clientSummary;
        }

        // Retornar el resumen
        return this.transformResponse(clientSummaries);
      } catch (error) {
        strapi.log.error(error);
        return ctx.internalServerError(
          "Ocurrió un error al procesar la solicitud"
        );
      }
    },
    async getClientAccountsForAllTrainers(ctx) {
      try {
        const { months } = ctx.params;

        // Obtener todos los entrenadores
        const trainers = await strapi.entityService.findMany(
          "api::trainer.trainer",
          {
            fields: ["name"], // Solo necesitamos los nombres de los entrenadores
          }
        );

        if (!trainers.length) {
          return ctx.notFound(
            "No se encontraron entrenadores en la base de datos"
          );
        }

        const accountSummaries = {};

        // Iterar sobre cada entrenador
        for (const trainer of trainers) {
          const trainerName = trainer.name;

          // Obtener clientes asociados al entrenador
          const clients = await strapi.entityService.findMany(
            "api::client.client",
            {
              filters: { trainer: trainerName },
              fields: ["id"], // Solo necesitamos los IDs de los clientes
            }
          );

          if (!clients.length) {
            accountSummaries[trainerName] = {
              message: "No se encontraron clientes para este entrenador",
            };
            continue;
          }

          // Extraer los IDs de los clientes
          const clientIds = clients.map((client) => client.id);

          // Obtener fecha de inicio y fin de los últimos meses
          const now = new Date();
          const threeMonthsAgo = new Date();
          threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - (months - 1));
          threeMonthsAgo.setDate(1); // Inicio del primer mes

          const endOfMonth = new Date();
          endOfMonth.setMonth(endOfMonth.getMonth() + 1, 0); // Último día del mes actual
          endOfMonth.setHours(23, 59, 59, 999);

          // Buscar registros de pagos en los últimos meses
          const paymentRecords = await strapi.entityService.findMany(
            "api::payment-record.payment-record",
            {
              filters: {
                client: {
                  id: { $in: clientIds }, // Filtrar por clientes
                },
                paymentDate: {
                  $gte: threeMonthsAgo.toISOString(), // Desde el inicio de los meses
                  $lte: endOfMonth.toISOString(), // Hasta el último día del mes actual
                },
              },
            }
          );

          if (!paymentRecords.length) {
            accountSummaries[trainerName] = {
              message:
                "No se encontraron registros de pagos para este entrenador",
            };
            continue;
          }

          const calculateBonus = (payments, accumulatedCount) => {
            let bonus = 0;
            let eligibleCount = accumulatedCount;

            payments.forEach((payment) => {
              if (payment.plan === "6 dias" && payment.status === "paid") {
                eligibleCount += 1;

                if (eligibleCount > 7) {
                  const amount = parseFloat(payment.amount);
                  const discount = payment.hasDiscounted
                    ? parseFloat(payment.discountAmount || 0)
                    : 0;

                  if (!payment.hasDiscounted) {
                    bonus += amount / 2 - 40000;
                  } else if (payment.discountReason === "Promocion") {
                    bonus += (amount - discount) / 2 - 40000;
                  } else if (payment.discountReason === "Personal") {
                    bonus += amount / 2 - 40000;
                  }
                }
              }
            });

            return { bonus, eligibleCount };
          };

          const calculateCollected = (payments) => {
            return payments.reduce((sum, payment) => {
              if (payment.status === "pending") {
                return sum;
              }

              const amount = parseFloat(payment.amount);
              const discount = payment.hasDiscounted
                ? parseFloat(payment.discountAmount || 0)
                : 0;
              const reason = payment.discountReason;

              if (payment.plan === "6 dias") {
                if (payment.hasDiscounted) {
                  if (reason === "Promocion") {
                    return sum + (amount - discount) / 2;
                  } else if (reason === "Personal") {
                    return sum + amount / 2 - discount;
                  }
                }
                return sum + amount / 2;
              } else if (payment.plan === "3 dias") {
                if (payment.hasDiscounted) {
                  if (reason === "Promocion") {
                    return sum + 50000 - discount;
                  } else if (reason === "Personal") {
                    return sum + 50000 - discount;
                  }
                }
                return sum + 50000;
              }

              return sum;
            }, 0);
          };

          const calculateGenerated = (payments) => {
            return payments.reduce((sum, payment) => {
              if (payment.status === "pending") {
                return sum;
              }

              const amount = parseFloat(payment.amount);
              const discount = payment.hasDiscounted
                ? parseFloat(payment.discountAmount || 0)
                : 0;

              if (payment.hasDiscounted) {
                const reason = payment.discountReason;
                if (reason === "Promocion" || reason === "Personal") {
                  return sum + (amount - discount);
                }
              }

              return sum + amount;
            }, 0);
          };

          const calculatePendingGenerated = (payments) => {
            return payments.reduce((sum, payment) => {
              if (payment.status === "pending") {
                const amount = parseFloat(payment.amount);
                const discount = payment.hasDiscounted
                  ? parseFloat(payment.discountAmount || 0)
                  : 0;

                if (payment.hasDiscounted) {
                  const reason = payment.discountReason;
                  if (reason === "Promocion" || reason === "Personal") {
                    return sum + (amount - discount);
                  }
                }
                return sum + amount;
              }
              return sum;
            }, 0);
          };

          const accountSummary = {};

          for (let i = 0; i < months; i++) {
            const month = new Date();
            month.setMonth(now.getMonth() - i);
            const year = month.getFullYear();
            const monthNumber = month.getMonth() + 1;
            const startFirstHalf = new Date(year, monthNumber - 1, 1);
            const endFirstHalf = new Date(year, monthNumber - 1, 15);
            const startSecondHalf = new Date(year, monthNumber - 1, 16);
            const endSecondHalf = new Date(year, monthNumber, 0);

            if (i == 0) {
              const currentMonth = new Date();
              let isFirstHalf = false;
              if (
                currentMonth >= startFirstHalf &&
                currentMonth <= endFirstHalf
              ) {
                isFirstHalf = true;
              }
              let firstHalfPayments;
              let secondHalfPayments;
              if (isFirstHalf) {
                firstHalfPayments = paymentRecords.filter((payment) => {
                  const paymentDate = new Date(payment.updatedAt);
                  return (
                    paymentDate >= startFirstHalf && paymentDate <= endFirstHalf
                  );
                });
                secondHalfPayments = paymentRecords.filter((payment) => {
                  const paymentDate = new Date(payment.paymentDate);
                  return (
                    paymentDate >= startSecondHalf &&
                    paymentDate <= endSecondHalf
                  );
                });
              } else {
                firstHalfPayments = paymentRecords.filter((payment) => {
                  const paymentDate = new Date(payment.createdAt);
                  return (
                    paymentDate >= startFirstHalf && paymentDate <= endFirstHalf
                  );
                });
                secondHalfPayments = paymentRecords.filter((payment) => {
                  const paymentDate = new Date(payment.updatedAt);
                  return (
                    paymentDate >= startSecondHalf &&
                    paymentDate <= endSecondHalf
                  );
                });
              }

              accountSummary[`${year}-${monthNumber}`] = {
                firstHalf: {
                  totalCollected: calculateCollected(firstHalfPayments),
                  totalGenerated: calculateGenerated(firstHalfPayments),
                  bonus: calculateBonus(firstHalfPayments, 0).bonus,
                  pendingGenerated:
                    calculatePendingGenerated(firstHalfPayments),
                },
                secondHalf: {
                  totalCollected: calculateCollected(secondHalfPayments),
                  totalGenerated: calculateGenerated(secondHalfPayments),
                  bonus: calculateBonus(
                    secondHalfPayments,
                    calculateBonus(firstHalfPayments, 0).eligibleCount
                  ).bonus,
                  pendingGenerated:
                    calculatePendingGenerated(secondHalfPayments),
                },
              };
              console.log("SUMMARY: ", accountSummary);
            }

            const firstHalfPayments = paymentRecords.filter((payment) => {
              const paymentDate = new Date(payment.paymentDate);
              return (
                paymentDate >= startFirstHalf && paymentDate <= endFirstHalf
              );
            });

            const secondHalfPayments = paymentRecords.filter((payment) => {
              const paymentDate = new Date(payment.paymentDate);
              return (
                paymentDate >= startSecondHalf && paymentDate <= endSecondHalf
              );
            });

            accountSummary[`${year}-${monthNumber}`] = {
              firstHalf: {
                totalCollected: calculateCollected(firstHalfPayments),
                totalGenerated: calculateGenerated(firstHalfPayments),
                bonus: calculateBonus(firstHalfPayments, 0).bonus,
                pendingGenerated: calculatePendingGenerated(firstHalfPayments),
              },
              secondHalf: {
                totalCollected: calculateCollected(secondHalfPayments),
                totalGenerated: calculateGenerated(secondHalfPayments),
                bonus: calculateBonus(
                  secondHalfPayments,
                  calculateBonus(firstHalfPayments, 0).eligibleCount
                ).bonus,
                pendingGenerated: calculatePendingGenerated(secondHalfPayments),
              },
            };
          }

          accountSummaries[trainerName] = accountSummary;
        }

        // Retornar el resumen de todas las cuentas
        return this.transformResponse(accountSummaries);
      } catch (error) {
        strapi.log.error(error);
        return ctx.internalServerError(
          "Ocurrió un error al procesar la solicitud"
        );
      }
    },

    async getClientsSummaryForAllTrainers(ctx) {
      try {
        const { months } = ctx.params;

        // Obtener todos los entrenadores
        const trainers = await strapi.entityService.findMany(
          "api::trainer.trainer",
          {
            fields: ["id", "name"], // Solo necesitamos los id's de los entrenadores
          }
        );

        if (!trainers.length) {
          return ctx.notFound(
            "No se encontraron entrenadores en la base de datos"
          );
        }
        const clientSummary = {};
        for (const trainer of trainers) {
          const trainerId = trainer.id;
          const trainerName = trainer.name;
          // Obtener fecha de inicio y fin de los últimos meses
          const now = new Date();
          const threeMonthsAgo = new Date();
          threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - (months - 1));
          threeMonthsAgo.setDate(1); // Inicio del primer mes

          const endOfMonth = new Date();
          endOfMonth.setMonth(endOfMonth.getMonth() + 1, 0); // Último día del mes actual
          endOfMonth.setHours(23, 59, 59, 999);

          // Buscar registros de pagos en los últimos meses
          const paymentRecords = await strapi.entityService.findMany(
            "api::payment-record.payment-record",
            {
              filters: {
                trainer: trainerId,
                paymentDate: {
                  $gte: threeMonthsAgo.toISOString(), // Desde el inicio de los meses
                  $lte: endOfMonth.toISOString(), // Hasta el último día del mes actual
                },
              },
            }
          );
          const accountSummary = {};
          // Funciones para hacer los calculos
          // Primera
          const calculateFortNightIncome = (payments, startDate, limitDate) => {
            return payments.reduce((sum, payment) => {
              const receiptDate = payment.receiptDate
                ? new Date(payment.receiptDate)
                : undefined;
              const paymentDate = new Date(payment.paymentDate);
              if (payment.currentPaymentStatus == "pending") return sum;
              if (receiptDate > limitDate) return sum;
              if (paymentDate < startDate) return sum;
              const amount = parseFloat(payment.amount);
              if (payment.hasDiscounted) {
                const discount = payment.hasDiscounted
                  ? parseFloat(payment.discountAmount || 0)
                  : 0;
                return sum + (amount - discount);
              }

              return sum + amount;
            }, 0);
          };
          // Segunda
          const calculateXDayPlanTotalPayments = (
            payments,
            plan,
            limitDate
          ) => {
            return payments.reduce((count, payment) => {
              const receiptDate = payment.receiptDate
                ? new Date(payment.receiptDate)
                : undefined;
              if (payment.currentPaymentStatus == "pending") return count;
              if (receiptDate > limitDate) return count;

              if (payment.plan == `${plan} dias`) {
                count += 1;
              }
              return count;
            }, 0);
          };
          // Tercera
          const calculateXDayPlanTotalPending = (payments, plan, limitDate) => {
            return payments.reduce((count, payment) => {
              const receiptDate = payment.receiptDate
                ? new Date(payment.receiptDate)
                : undefined;
              if (receiptDate <= limitDate) {
                return count;
              }

              if (payment.plan == `${plan} dias`) {
                count += 1;
              }
              return count;
            }, 0);
          };
          // Cuarta
          const calculatePendingIncome = (payments, limitDate) => {
            return payments.reduce((sum, payment) => {
              const receiptDate = payment.receiptDate
                ? new Date(payment.receiptDate)
                : undefined;
              if (receiptDate <= limitDate) return sum;
              const amount = parseFloat(payment.amount);
              if (payment.hasDiscounted) {
                const discount = payment.hasDiscounted
                  ? parseFloat(payment.discountAmount || 0)
                  : 0;
                return sum + (amount - discount);
              }
              return sum + amount;
            }, 0);
          };
          // Quinta
          const calculateIncomeFromLastFortNight = (payments) => {
            return payments.reduce((sum, payment) => {
              if (payment.currentPaymentStatus === "pending") return sum;
              const amount = parseFloat(payment.amount);
              if (payment.hasDiscounted) {
                const discount = payment.hasDiscounted
                  ? parseFloat(payment.discountAmount || 0)
                  : 0;
                return sum + (amount - discount);
              }
              return sum + amount;
            }, 0);
          };
          // Sexta
          const calculateTrainerIncome = (
            currentFortNightPayment,
            previousFortNightPayments,
            startDate,
            limitDate
          ) => {
            const currentFortNightTrainerIncome =
              currentFortNightPayment.reduce((sum, payment) => {
                const receiptDate = payment.receiptDate
                  ? new Date(payment.receiptDate)
                  : undefined;
                const paymentDate = new Date(payment.paymentDate);
                if (payment.currentPaymentStatus == "pending") return sum;
                if (receiptDate > limitDate) return sum;
                if (paymentDate < startDate) return sum;
                const amount = parseFloat(payment.amount);
                if (payment.hasDiscounted) {
                  const discount = payment.hasDiscounted
                    ? parseFloat(payment.discountAmount || 0)
                    : 0;
                  return sum + (amount - discount);
                } else {
                  sum + amount / 2;
                }
              }, 0);
            return currentFortNightTrainerIncome;
          };
          for (let i = 0; i < months; i++) {
            let previousFirstHalfPayments = {};
            let previousSecondHalfPayments = {};
            let firstHalfPayments = {};
            let secondHalfPayments = {};
            const month = new Date();
            month.setMonth(now.getMonth() - i);
            const year = month.getFullYear();
            const monthNumber = month.getMonth() + 1;
            const startFirstHalf = new Date(year, monthNumber - 1, 1);
            startFirstHalf.setUTCHours(0, 0, 0, 0);
            const endFirstHalf = new Date(year, monthNumber - 1, 15);
            endFirstHalf.setUTCHours(0, 0, 0, 0);
            const startSecondHalf = new Date(year, monthNumber - 1, 16);
            startSecondHalf.setUTCHours(0, 0, 0, 0);
            const endSecondHalf = new Date(year, monthNumber, 0);
            endSecondHalf.setUTCHours(0, 0, 0, 0);
            // Calculo para la quincena anterior
            const month2 = new Date();
            month2.setMonth(now.getMonth() - i - 1);
            const previousMonthNumber = month2.getMonth() + 1;
            const yearForPreviousMonth = month2.getFullYear();
            const startPreviousFirstHalf = new Date(year, monthNumber - 1, 1);
            startPreviousFirstHalf.setUTCHours(0, 0, 0, 0);
            const endPreviousFirstHalf = new Date(year, monthNumber - 1, 15);
            endPreviousFirstHalf.setUTCHours(0, 0, 0, 0);
            const startPreviousSecondHalf = new Date(
              yearForPreviousMonth,
              previousMonthNumber - 1,
              16
            );
            startPreviousSecondHalf.setUTCHours(0, 0, 0, 0);
            const endPreviousSecondHalf = new Date(
              yearForPreviousMonth,
              previousMonthNumber,
              0
            );
            endPreviousSecondHalf.setUTCHours(0, 0, 0, 0);

            previousFirstHalfPayments = paymentRecords.filter((payment) => {
              const paymentDate = new Date(payment.paymentDate);
              const receiptDate = new Date(payment.receiptDate);
              return (
                paymentDate >= startPreviousFirstHalf &&
                paymentDate <= endPreviousFirstHalf &&
                receiptDate >= startSecondHalf &&
                receiptDate <= endSecondHalf
              );
            });
            previousSecondHalfPayments = paymentRecords.filter((payment) => {
              const paymentDate = new Date(payment.paymentDate);
              const receiptDate = new Date(payment.receiptDate);
              return (
                paymentDate >= startPreviousSecondHalf &&
                paymentDate <= endPreviousSecondHalf &&
                receiptDate >= startFirstHalf &&
                receiptDate <= endFirstHalf
              );
            });
            firstHalfPayments = paymentRecords.filter((payment) => {
              const paymentDate = new Date(payment.paymentDate);
              const receiptDate = new Date(payment.receiptDate);
              return (
                (paymentDate >= startFirstHalf &&
                  paymentDate <= endFirstHalf) ||
                (receiptDate >= startFirstHalf && receiptDate <= endFirstHalf)
              );
            });
            secondHalfPayments = paymentRecords.filter((payment) => {
              const paymentDate = new Date(payment.paymentDate);
              const receiptDate = new Date(payment.receiptDate);
              return (
                (paymentDate >= startSecondHalf &&
                  paymentDate <= endSecondHalf) ||
                (receiptDate >= startSecondHalf && receiptDate <= endSecondHalf)
              );
            });
            accountSummary[`${year}-${monthNumber}`] = {
              firstHalf: {
                fortNight: "Primera",
                sixDaysPlanTotalPayments: calculateXDayPlanTotalPayments(
                  firstHalfPayments,
                  "6",
                  endFirstHalf
                ),
                sixDaysPlanTotalPending: calculateXDayPlanTotalPending(
                  firstHalfPayments,
                  "6",
                  endFirstHalf
                ),
                threeDaysPlanTotalPayments: calculateXDayPlanTotalPayments(
                  firstHalfPayments,
                  "3",
                  endFirstHalf
                ),
                threeDaysPlanTotalPending: calculateXDayPlanTotalPending(
                  firstHalfPayments,
                  "3",
                  endFirstHalf
                ),
                fortNightIncome: calculateFortNightIncome(
                  firstHalfPayments,
                  startFirstHalf,
                  endFirstHalf
                ),
                pendinIncome: calculatePendingIncome(
                  firstHalfPayments,
                  endFirstHalf
                ),
                incomeFromLastFortNight: calculateIncomeFromLastFortNight(
                  previousSecondHalfPayments
                ),
                grossIncome:
                  calculateFortNightIncome(
                    firstHalfPayments,
                    startFirstHalf,
                    endFirstHalf
                  ) +
                  calculateIncomeFromLastFortNight(previousSecondHalfPayments),
                trainerIncome: calculateTrainerIncome(
                  firstHalfPayments,
                  previousSecondHalfPayments,
                  startFirstHalf,
                  endFirstHalf
                ),
              },
              secondHalf: {
                fortNight: "Segunda",
                sixDaysPlanTotalPayments: calculateXDayPlanTotalPayments(
                  secondHalfPayments,
                  "6",
                  endSecondHalf
                ),
                sixDaysPlanTotalPending: calculateXDayPlanTotalPending(
                  secondHalfPayments,
                  "6",
                  endSecondHalf
                ),
                threeDaysPlanTotalPayments: calculateXDayPlanTotalPayments(
                  secondHalfPayments,
                  "3",
                  endSecondHalf
                ),
                threeDaysPlanTotalPending: calculateXDayPlanTotalPending(
                  secondHalfPayments,
                  "3",
                  endSecondHalf
                ),
                fortNightIncome: calculateFortNightIncome(
                  secondHalfPayments,
                  startSecondHalf,
                  endSecondHalf
                ),
                pendinIncome: calculatePendingIncome(
                  secondHalfPayments,
                  endSecondHalf
                ),
                incomeFromLastFortNight: calculateIncomeFromLastFortNight(
                  previousFirstHalfPayments
                ),
                grossIncome:
                  calculateFortNightIncome(
                    secondHalfPayments,
                    startSecondHalf,
                    endSecondHalf
                  ) +
                  calculateIncomeFromLastFortNight(previousFirstHalfPayments),
              },
            };
            clientSummary[trainerName] = accountSummary;
            // return this.transformResponse(clientSummary);
          }
        }
        return this.transformResponse(clientSummary);
      } catch (error) {
        strapi.log.error(error);
        return ctx.internalServerError(
          "Ocurrió un error al procesar la solicitud"
        );
      }
    },

    async getPaymentSummaryForAllTrainers(ctx) {
      try {
        const { months } = ctx.params;

        // Obtener la lista de entrenadores
        const trainers = await strapi.entityService.findMany(
          "api::trainer.trainer",
          {
            fields: ["name"], // Solo necesitamos el nombre de los entrenadores
          }
        );

        if (!trainers.length) {
          return ctx.notFound(
            "No se encontraron entrenadores en la base de datos"
          );
        }

        const paymentSummaries = {};

        // Iterar sobre cada entrenador y procesar su resumen
        for (const trainer of trainers) {
          const trainerName = trainer.name;

          // Obtener clientes asociados al entrenador
          const clients = await strapi.entityService.findMany(
            "api::client.client",
            {
              filters: { trainer: trainerName },
              fields: ["id"], // Solo necesitamos los IDs de los clientes
            }
          );

          if (!clients.length) {
            paymentSummaries[trainerName] = {
              message: "No se encontraron clientes para este entrenador",
            };
            continue;
          }

          // Extraer los IDs de los clientes
          const clientIds = clients.map((client) => client.id);

          // Obtener fecha de inicio y fin de los últimos tres meses
          const now = new Date();
          const threeMonthsAgo = new Date();
          threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - (months - 1));
          threeMonthsAgo.setDate(1); // Inicio del primer mes

          // Buscar registros de pagos en los últimos meses
          const paymentRecords = await strapi.entityService.findMany(
            "api::payment-record.payment-record",
            {
              filters: {
                client: {
                  id: { $in: clientIds }, // Filtrar por clientes
                },
                paymentDate: {
                  $gte: threeMonthsAgo.toISOString(), // Desde hace tres meses
                  $lte: now.toISOString(), // Hasta hoy
                },
              },
            }
          );

          if (!paymentRecords.length) {
            paymentSummaries[trainerName] = {
              message:
                "No se encontraron registros de pagos para este entrenador",
            };
            continue;
          }

          // Procesar los datos del entrenador
          const paymentSummary = {};

          for (let i = 0; i < months; i++) {
            const month = new Date();
            month.setMonth(now.getMonth() - i);
            const year = month.getFullYear();
            const monthNumber = month.getMonth() + 1; // Mes 1-indexado
            const startFirstHalf = new Date(year, monthNumber - 1, 1); // Inicio 1ra quincena
            const endFirstHalf = new Date(year, monthNumber - 1, 15); // Fin 1ra quincena
            const startSecondHalf = new Date(year, monthNumber - 1, 16); // Inicio 2da quincena
            const endSecondHalf = new Date(year, monthNumber, 0); // Fin del mes

            const firstHalfPayments = paymentRecords.filter((payment) => {
              const paymentDate = new Date(payment.paymentDate);
              return (
                paymentDate >= startFirstHalf && paymentDate <= endFirstHalf
              );
            });

            const secondHalfPayments = paymentRecords.filter((payment) => {
              const paymentDate = new Date(payment.paymentDate);
              return (
                paymentDate >= startSecondHalf && paymentDate <= endSecondHalf
              );
            });

            const calculateCollected = (payments) => {
              return payments.reduce((sum, payment) => {
                const amount = parseFloat(payment.amount);
                const discount = payment.hasDiscounted
                  ? parseFloat(payment.discountAmount || 0)
                  : 0;
                const reason = payment.discountReason;

                if (payment.hasDiscounted) {
                  if (reason === "Promocion") {
                    return sum + (amount - discount) / 2;
                  } else if (reason === "Personal") {
                    return sum + amount / 2 - discount;
                  }
                }

                return sum + amount;
              }, 0);
            };

            const calculateGenerated = (payments) => {
              return payments.reduce((sum, payment) => {
                const amount = parseFloat(payment.amount);
                const discount = payment.hasDiscounted
                  ? parseFloat(payment.discountAmount || 0)
                  : 0;

                if (payment.hasDiscounted) {
                  const reason = payment.discountReason;
                  if (reason === "Promocion") {
                    return sum + (amount - discount) / 2;
                  } else if (reason === "Personal") {
                    return sum + amount / 2 - discount;
                  }
                }

                return sum + amount / 2;
              }, 0);
            };

            const calculatePlanCounts = (payments) => {
              return payments.reduce(
                (counts, payment) => {
                  if (payment.plan === "3 dias") {
                    if (payment.status === "pending") {
                      counts.pending["3 dias"] += 1;
                    } else if (payment.status === "paid") {
                      counts.actives["3 dias"] += 1;
                    }
                  } else if (payment.plan === "6 dias") {
                    if (payment.status === "pending") {
                      counts.pending["6 dias"] += 1;
                    } else if (payment.status === "paid") {
                      counts.actives["6 dias"] += 1;
                    }
                  }
                  return counts;
                },
                {
                  pending: { "3 dias": 0, "6 dias": 0 },
                  actives: { "3 dias": 0, "6 dias": 0 },
                }
              );
            };

            paymentSummary[`${year}-${monthNumber}`] = {
              firstHalf: {
                totalClients: firstHalfPayments.length,
                totalCollected: calculateCollected(firstHalfPayments),
                totalGenerated: calculateGenerated(firstHalfPayments),
                planCounts: calculatePlanCounts(firstHalfPayments),
              },
              secondHalf: {
                totalClients: secondHalfPayments.length,
                totalCollected: calculateCollected(secondHalfPayments),
                totalGenerated: calculateGenerated(secondHalfPayments),
                planCounts: calculatePlanCounts(secondHalfPayments),
              },
            };
          }

          // Agregar el resumen del entrenador al objeto principal
          paymentSummaries[trainerName] = paymentSummary;
        }

        // Retornar el resumen de todos los entrenadores
        return this.transformResponse(paymentSummaries);
      } catch (error) {
        strapi.log.error(error);
        return ctx.internalServerError(
          "Ocurrió un error al procesar la solicitud"
        );
      }
    },
  })
);
