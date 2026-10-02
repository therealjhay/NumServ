import { PrismaClient, NumberType, ProviderStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // ─── Providers ───────────────────────────────
  const smsActivate = await prisma.provider.upsert({
    where: { name: "smsactivate" },
    update: {},
    create: {
      name: "smsactivate",
      displayName: "SMSActivate",
      apiBaseUrl: "https://api.sms-activate.org/stubs/handler_api.php",
      status: ProviderStatus.ACTIVE,
      priority: 1,
      successRate: 95.5,
      avgDeliveryMs: 12000,
    },
  });

  const fiveSim = await prisma.provider.upsert({
    where: { name: "5sim" },
    update: {},
    create: {
      name: "5sim",
      displayName: "5SIM",
      apiBaseUrl: "https://5sim.net/api/v1",
      status: ProviderStatus.ACTIVE,
      priority: 2,
      successRate: 91.2,
      avgDeliveryMs: 15000,
    },
  });

  console.log(`  ✅ Providers: ${smsActivate.displayName}, ${fiveSim.displayName}`);

  // ─── Services ────────────────────────────────
  const services = [
    { slug: "telegram", displayName: "Telegram", iconUrl: "/icons/telegram.svg" },
    { slug: "whatsapp", displayName: "WhatsApp", iconUrl: "/icons/whatsapp.svg" },
    { slug: "gmail", displayName: "Gmail", iconUrl: "/icons/gmail.svg" },
    { slug: "instagram", displayName: "Instagram", iconUrl: "/icons/instagram.svg" },
    { slug: "twitter", displayName: "X (Twitter)", iconUrl: "/icons/twitter.svg" },
  ];

  const createdServices = [];
  for (const svc of services) {
    const created = await prisma.service.upsert({
      where: { slug: svc.slug },
      update: {},
      create: svc,
    });
    createdServices.push(created);
  }

  console.log(`  ✅ Services: ${createdServices.map((s) => s.slug).join(", ")}`);

  // ─── Number Prices ───────────────────────────
  const countries = ["US", "UK", "NG", "CA", "DE"];
  const priceMatrix: Record<string, Record<string, { price: number; cost: number }>> = {
    telegram: {
      US: { price: 0.15, cost: 0.08 },
      UK: { price: 0.18, cost: 0.10 },
      NG: { price: 0.10, cost: 0.05 },
      CA: { price: 0.16, cost: 0.09 },
      DE: { price: 0.17, cost: 0.09 },
    },
    whatsapp: {
      US: { price: 0.12, cost: 0.06 },
      UK: { price: 0.14, cost: 0.08 },
      NG: { price: 0.08, cost: 0.04 },
      CA: { price: 0.13, cost: 0.07 },
      DE: { price: 0.14, cost: 0.08 },
    },
    gmail: {
      US: { price: 0.20, cost: 0.12 },
      UK: { price: 0.22, cost: 0.14 },
      NG: { price: 0.15, cost: 0.08 },
      CA: { price: 0.21, cost: 0.13 },
      DE: { price: 0.22, cost: 0.13 },
    },
    instagram: {
      US: { price: 0.10, cost: 0.05 },
      UK: { price: 0.12, cost: 0.06 },
      NG: { price: 0.07, cost: 0.03 },
      CA: { price: 0.11, cost: 0.06 },
      DE: { price: 0.12, cost: 0.06 },
    },
    twitter: {
      US: { price: 0.11, cost: 0.06 },
      UK: { price: 0.13, cost: 0.07 },
      NG: { price: 0.08, cost: 0.04 },
      CA: { price: 0.12, cost: 0.06 },
      DE: { price: 0.13, cost: 0.07 },
    },
  };

  for (const service of createdServices) {
    for (const country of countries) {
      const matrix = priceMatrix[service.slug]?.[country];
      if (!matrix) continue;

      await prisma.numberPrice.upsert({
        where: {
          serviceId_countryCode_type: {
            serviceId: service.id,
            countryCode: country,
            type: NumberType.TEMPORARY,
          },
        },
        update: { priceUsd: matrix.price, providerCost: matrix.cost },
        create: {
          serviceId: service.id,
          countryCode: country,
          type: NumberType.TEMPORARY,
          priceUsd: matrix.price,
          providerCost: matrix.cost,
        },
      });
    }
  }

  console.log("  ✅ Number prices seeded for all services × countries");

  // ─── Virtual Numbers ─────────────────────────
  const numberData = [
    { number: "+12025550101", countryCode: "US", providerId: smsActivate.id },
    { number: "+12025550102", countryCode: "US", providerId: smsActivate.id },
    { number: "+12025550103", countryCode: "US", providerId: fiveSim.id },
    { number: "+12025550104", countryCode: "US", providerId: fiveSim.id },
    { number: "+12025550105", countryCode: "US", providerId: smsActivate.id },
    { number: "+447700900101", countryCode: "UK", providerId: smsActivate.id },
    { number: "+447700900102", countryCode: "UK", providerId: fiveSim.id },
    { number: "+447700900103", countryCode: "UK", providerId: smsActivate.id },
    { number: "+447700900104", countryCode: "UK", providerId: fiveSim.id },
    { number: "+447700900105", countryCode: "UK", providerId: smsActivate.id },
    { number: "+2348012345601", countryCode: "NG", providerId: smsActivate.id },
    { number: "+2348012345602", countryCode: "NG", providerId: fiveSim.id },
    { number: "+2348012345603", countryCode: "NG", providerId: smsActivate.id },
    { number: "+2348012345604", countryCode: "NG", providerId: fiveSim.id },
    { number: "+2348012345605", countryCode: "NG", providerId: smsActivate.id },
    { number: "+12025550106", countryCode: "CA", providerId: smsActivate.id },
    { number: "+12025550107", countryCode: "CA", providerId: fiveSim.id },
    { number: "+12025550108", countryCode: "DE", providerId: smsActivate.id },
    { number: "+12025550109", countryCode: "DE", providerId: fiveSim.id },
    { number: "+12025550110", countryCode: "DE", providerId: smsActivate.id },
  ];

  for (const num of numberData) {
    await prisma.virtualNumber.upsert({
      where: { number: num.number },
      update: {},
      create: {
        number: num.number,
        countryCode: num.countryCode,
        providerId: num.providerId,
        providerNumberId: `ext_${num.number.replace("+", "")}`,
      },
    });
  }

  console.log(`  ✅ ${numberData.length} virtual numbers seeded`);

  // ─── Test Users ──────────────────────────────
  const bcryptHash = "$2b$10$dummyHashForSeedDataOnly0000000000000000000000";

  const user1 = await prisma.user.upsert({
    where: { email: "alice@test.com" },
    update: {},
    create: {
      email: "alice@test.com",
      passwordHash: bcryptHash,
      fullName: "Alice Test",
      country: "NG",
      status: "ACTIVE",
      kycTier: "NONE",
      emailVerifiedAt: new Date(),
    },
  });

  const user2 = await prisma.user.upsert({
    where: { email: "bob@test.com" },
    update: {},
    create: {
      email: "bob@test.com",
      passwordHash: bcryptHash,
      fullName: "Bob Test",
      country: "US",
      status: "ACTIVE",
      kycTier: "NONE",
      emailVerifiedAt: new Date(),
    },
  });

  // Create wallets for test users
  await prisma.wallet.upsert({
    where: { userId: user1.id },
    update: {},
    create: { userId: user1.id, balance: 50.0, currency: "USD" },
  });

  await prisma.wallet.upsert({
    where: { userId: user2.id },
    update: {},
    create: { userId: user2.id, balance: 25.5, currency: "USD" },
  });

  console.log(`  ✅ Test users: ${user1.email}, ${user2.email}`);

  console.log("🎉 Seed complete!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });