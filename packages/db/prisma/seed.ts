import { PrismaClient, ProviderStatus } from "@prisma/client";

const prisma = new PrismaClient();

// ─────────────────────────────────────────────
// Real-only seed: providers + services.
// No fake numbers, no fake prices, no test users.
// Prices sync from live provider APIs; numbers are
// created only on real activation.
// ─────────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding database (real-only)...");

  const fiveSim = await prisma.provider.upsert({
    where: { name: "5sim" },
    update: {},
    create: {
      name: "5sim",
      displayName: "5SIM",
      apiBaseUrl: "https://5sim.net/v1",
      status: ProviderStatus.ACTIVE,
      priority: 1,
      successRate: 91.2,
      avgDeliveryMs: 15000,
    },
  });

  const smspva = await prisma.provider.upsert({
    where: { name: "smspva" },
    update: {},
    create: {
      name: "smspva",
      displayName: "SMSPVA",
      apiBaseUrl: "https://smspva.com/priemnik.php",
      status: ProviderStatus.ACTIVE,
      priority: 2,
      successRate: 88.0,
      avgDeliveryMs: 18000,
    },
  });

  console.log(`  ✅ Providers: ${fiveSim.displayName}, ${smspva.displayName}`);

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
  console.log("🎉 Seed complete (real-only, no mock data).");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
