module.exports = {
  routes: [
    {
      method: "GET",
      path: "/last-three-payments/:clientId",
      handler: "payment-record.lastThree",
    },
    {
      method: "GET",
      path: "/payment-records/trainer/:trainer",
      handler: "payment-record.byTrainer",
    },
    {
      method: "GET",
      path: "/payment-records/all-summary/:months",
      handler: "payment-record.getClientsSummaryForAllTrainers",
    },
    {
      method: "GET",
      path: "/payment-records/trainer-summary/:trainerId/:months",
      handler: "payment-record.getClientsSummaryByTrainer",
    },
  ],
};
