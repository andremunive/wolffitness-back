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
      path: "/payment-records/summary/:trainer/:months",
      handler: "payment-record.getPaymentSummaryByTrainer",
    },
    {
      method: "GET",
      path: "/payment-records/all-summary/:months",
      handler: "payment-record.getPaymentSummaryForAllTrainers",
    },
  ],
};
