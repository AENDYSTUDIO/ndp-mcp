import { ethers } from "ethers";
import { contracts, chainEnabled, statusMap } from "../services/blockchain.js";
import { triggerN8nWorkflow } from "../services/n8n.js";
import { registryGet, registryPost, oraclePost } from "../services/registry.js";

// Chain-слой эпохи Polygon отключён (нет NDP_*_CONTRACT/POLYGON_RPC_URL в env).
const CHAIN_OFF_TEXT = "⛓️ Blockchain-слой NDP отключён на этом инстансе (адреса контрактов Polygon не заданы). Данные реестра Стадии 0 доступны через: get_track_manifest, identify_track, register_track, audience-инструменты.";
const chainOff = () => ({ content: [{ type: "text", text: CHAIN_OFF_TEXT }] });

export async function handleVerifyArtist(args) {
  try {
    // blockchain-инстансы: старый chain-путь (паспорт SBT + реестр контрактов)
    if (chainEnabled) {
      const walletAddress = args.wallet_address;
      if (!walletAddress) return { content: [{ type: "text", text: "⚠️  Chain-режим: укажите wallet_address (поиск по имени был в legacy Supabase)" }] };

      const tokenId = await contracts.sbt.walletToToken(walletAddress);
      if (tokenId === 0n) return { content: [{ type: "text", text: `❌ Кошелёк ${walletAddress} не имеет паспорта NDP` }] };

      const isVerified = await contracts.sbt.isVerified(walletAddress);
      const trackCount = await contracts.registry.getArtistTrackCount(walletAddress);

      const status = isVerified ? "✅ Верифицирован" : "⏳ Ожидает верификации";
      return {
        content: [{
          type: "text",
          text: `${status}\n\n🔗 Кошелёк: ${walletAddress}\n🆔 Passport ID: ${tokenId}\n🎵 Треков: ${trackCount}`
        }]
      };
    }

    // RF-контур: реестр Стадии 0 (PostgreSQL), поиск по имени артиста
    const name = args.artist_name;
    if (!name) {
      return { content: [{ type: "text", text: "⚠️  Укажите artist_name — в реестре Стадии 0 артисты ищутся по имени (регистронезависимо). Поиск по кошельку требует blockchain-слоя, на этом инстансе он отключён." }] };
    }
    const r = await registryGet(`/tracks?artist=${encodeURIComponent(name)}`);
    if (!r.total) {
      return { content: [{ type: "text", text: `❌ Артист «${name}» не найден в реестре Стадии 0. Проверьте написание имени или зарегистрируйте произведение через register_track.` }] };
    }
    const lines = r.items.map(t => `  • ${t.isrc} — ${t.title}${t.parent_isrc ? ` (производный от ${t.parent_isrc})` : ""}`);
    return {
      content: [{
        type: "text",
        text: `✅ АРТИСТ В РЕЕСТРЕ (Стадия 0)\n\n🎭 Артист: ${name}\n🎵 Треков: ${r.total}\n\n${lines.join("\n")}\n\n📋 Права и сплиты по треку: get_track_manifest(isrc); проверка звука: identify_track.`
      }]
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Ошибка при проверке артиста: ${error.message}` }] };
  }
}

export async function handleGetArtistPassport(args) {
  try {
    if (!chainEnabled) return chainOff();
    let tokenId = args.token_id;
    if (!tokenId && args.wallet_address) {
      tokenId = await contracts.sbt.walletToToken(args.wallet_address);
      if (tokenId === 0n) return { content: [{ type: "text", text: `❌ Паспорт не найден для кошелька ${args.wallet_address}` }] };
    }
    if (!tokenId) return { content: [{ type: "text", text: "⚠️  Укажите wallet_address или token_id" }] };
    
    const passportData = await contracts.sbt.getPassportData(tokenId);
    const statusText = statusMap.sbt[passportData.status] || "Неизвестно";
    const verificationType = statusMap.verificationType[passportData.verificationType] || "Неизвестно";
    
    return { 
      content: [{ 
        type: "text", 
        text: `🎫 ПАСПОРТ АРТИСТА #${tokenId}\n\n🎭 Сценическое имя: ${passportData.artistName}\n📛 Юридическое имя: ${passportData.legalName}\n📊 Тип верификации: ${verificationType}\n🔐 KYC Статус: ${passportData.kycStatus}\n🏢 KYC Провайдер: ${passportData.kycProvider}\n📅 KYC Дата: ${new Date(Number(passportData.kycDate) * 1000).toLocaleDateString('ru-RU')}\n📄 Статус: ${statusText}\n📅 Выдан: ${new Date(Number(passportData.mintedAt) * 1000).toLocaleDateString('ru-RU')}\n🔗 Metadata URI: ${passportData.metadataURI}` 
      }] 
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Ошибка при получении паспорта: ${error.message}` }] };
  }
}

export async function handleCheckTrackOwnership(args) {
  try {
    if (!chainEnabled) return chainOff();
    const exists = await contracts.registry.trackExists(args.isrc);
    if (!exists) return { content: [{ type: "text", text: `❌ Трек с ISRC ${args.isrc} не найден в реестре NDP` }] };
    
    const trackData = await contracts.registry.getTrack(args.isrc);
    const statusText = statusMap.track[trackData.status] || "Неизвестно";
    
    const artistName = "Неизвестно"; // профили артистов больше не в legacy Supabase
    
    const labelInfo = trackData.labelWallet !== ethers.ZeroAddress ? `Лейбл: ${trackData.labelWallet}` : "Статус: Инди-артист";
    
    return { 
      content: [{ 
        type: "text", 
        text: `🎵 ТРЕК: ${trackData.title}\n\n🆔 ISRC: ${args.isrc}\n🎭 Артист: ${artistName}\n🔗 Кошелёк: ${trackData.artistWallet}\n🏷️  ${labelInfo}\n📊 Статус: ${statusText}\n📅 Зарегистрирован: ${new Date(Number(trackData.registeredAt) * 1000).toLocaleDateString('ru-RU')}\n🔊 Audio Hash: ${trackData.audioHash.slice(0, 10)}...${trackData.audioHash.slice(-8)}` 
      }] 
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Ошибка при проверке трека: ${error.message}` }] };
  }
}

export async function handleGetRoyaltyBalance(args) {
  try {
    if (!chainEnabled) return chainOff();
    const balance = await contracts.splits.getTotalMATICBalance(args.isrc);
    const balanceInMatic = ethers.formatEther(balance);
    
    if (parseFloat(balanceInMatic) === 0) {
      try {
        const splitConfig = await contracts.splits.getSplitConfig(args.isrc);
        return { 
          content: [{ 
            type: "text", 
            text: `💰 БАЛАНС РОЯЛТИ: ${args.isrc}\n\n💵 Баланс: 0 MATIC\n📊 Сплиты настроены: ${splitConfig.isActive ? "✅ Да" : "❌ Нет"}` 
          }] 
        };
      } catch {
        return { content: [{ type: "text", text: `❌ Трек с ISRC ${args.isrc} не найден или сплиты не настроены` }] };
      }
    }
    
    const splitConfig = await contracts.splits.getSplitConfig(args.isrc);
    let recipientsInfo = "";
    for (let i = 0; i < splitConfig.recipients.length; i++) {
      const share = (parseFloat(balanceInMatic) * Number(splitConfig.percentages[i])) / 10000;
      recipientsInfo += `\n  • ${splitConfig.recipients[i]}: ${share.toFixed(4)} MATIC (${Number(splitConfig.percentages[i]) / 100}%)`;
    }
    
    return { 
      content: [{ 
        type: "text", 
        text: `💰 БАЛАНС РОЯЛТИ: ${args.isrc}\n\n💵 Общий баланс: ${parseFloat(balanceInMatic).toFixed(4)} MATIC\n📊 Получателей: ${splitConfig.recipients.length}\n\n📋 Распределение:${recipientsInfo}` 
      }] 
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Ошибка при получении баланса роялти: ${error.message}` }] };
  }
}

export async function handleGetLabelInfo(args) {
  try {
    if (!chainEnabled) return chainOff();
    const labelData = await contracts.label.getLabelData(args.label_wallet);
    const statusText = statusMap.label[labelData.status] || "Неизвестно";
    
    return { 
      content: [{ 
        type: "text", 
        text: `🏢 ЛЕЙБЛ\n\n📛 Название: ${labelData.name}\n🏛️  Юридическое имя: ${labelData.legalName}\n📋 Регистрационный номер: ${labelData.registrationNumber}\n📊 Статус: ${statusText}\n🔐 KYC: ${labelData.kycStatus}\n🎵 Треков подписано: ${labelData.tracksSigned}\n📅 Зарегистрирован: ${new Date(Number(labelData.registeredAt) * 1000).toLocaleDateString('ru-RU')}` 
      }] 
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Ошибка при получении информации о лейбле: ${error.message}` }] };
  }
}

export async function handleGetSystemStats() {
  try {
    if (!chainEnabled) return chainOff();
    const totalPassports = await contracts.sbt.totalPassportsMinted();
    const totalTracks = await contracts.registry.totalTracksRegistered();
    const splitsStats = await contracts.splits.getStats();
    const labelStats = await contracts.label.getLabelStats();
    
    return { 
      content: [{ 
        type: "text", 
        text: `📊 СТАТИСТИКА NDP\n\n🎫 Паспортов выдано: ${totalPassports}\n🎵 Треков зарегистрировано: ${totalTracks}\n🏢 Лейблов: ${labelStats.totalLabels}\n📝 Треков подписано лейблами: ${labelStats.totalTracks}\n\n💰 Роялти распределено:\n  • Выплат: ${splitsStats.totalPayments}\n  • Объём: ${ethers.formatEther(splitsStats.totalVolume)} MATIC\n  • Комиссия: ${Number(splitsStats.currentFeeBps) / 100}%\n  • Казначейство: ${splitsStats.treasury}` 
      }] 
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Ошибка при получении статистики: ${error.message}` }] };
  }
}

export async function handleCheckArtistTracks(args) {
  try {
    if (!chainEnabled) return chainOff();
    const trackCount = await contracts.registry.getArtistTrackCount(args.wallet_address);
    const artistName = "Неизвестно"; // профили артистов больше не в legacy Supabase
    
    return { 
      content: [{ 
        type: "text", 
        text: `🎵 ТРЕКИ АРТИСТА\n\n🎭 Артист: ${artistName}\n🔗 Кошелёк: ${args.wallet_address}\n📊 Зарегистрировано треков: ${trackCount}` 
      }] 
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Ошибка при получении информации о треках: ${error.message}` }] };
  }
}

export async function handleStartUcpCheckout(args) {
  try {
    if (!chainEnabled) return chainOff();
    const { isrc, currency = "MATIC" } = args;
    
    // 1. Проверяем существование трека
    const exists = await contracts.registry.trackExists(isrc);
    if (!exists) {
      return { content: [{ type: "text", text: `❌ Трек ${isrc} не найден в реестре NDP. Покупка невозможна.` }] };
    }
    
    // 2. Получаем данные трека и сплитов
    const trackData = await contracts.registry.getTrack(isrc);
    const splitConfig = await contracts.splits.getSplitConfig(isrc);
    
    if (!splitConfig.isActive) {
      return { content: [{ type: "text", text: `❌ Сплиты для трека ${isrc} не настроены. Продажа временно недоступна.` }] };
    }
    
    // 3. Формируем UCP Checkout манифест
    // В реальном сценарии здесь генерируется ссылка на Stripe/Crypto-Gateway или 
    // подготавливается транзакция для кошелька через n8n
    
    const checkoutData = {
      protocol: "NDP-UCP",
      action: "checkout",
      isrc: isrc,
      title: trackData.title,
      price: currency === "MATIC" ? "1.0" : "0.99", // Демо-цены
      currency: currency,
      recipients: splitConfig.recipients.map((addr, i) => ({
        address: addr,
        share: `${Number(splitConfig.percentages[i]) / 100}%`
      })),
      checkout_url: `https://ndp.market/checkout/${isrc}?cur=${currency}`
    };
    
    return { 
      content: [{ 
        type: "text", 
        text: `🛒 ИНИЦИАЦИЯ ПОКУПКИ (NDP Checkout, UCP-совместимый)\n\n🎵 Трек: ${trackData.title}\n🆔 ISRC: ${isrc}\n💰 Цена: ${checkoutData.price} ${currency}\n\n📝 Сплиты подтверждены для ${splitConfig.recipients.length} авторов.\n\n🔗 Ссылка для оплаты: ${checkoutData.checkout_url}\n\n*ИИ может продолжить оформление после подтверждения пользователем.*` 
      }] 
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Ошибка при инициации покупки: ${error.message}` }] };
  }
}

export async function handleTriggerN8n(args) {
  try {
    const responseData = await triggerN8nWorkflow(args.action, args.payload);
    return {
      content: [{
        type: "text",
        text: `✅ Запрос успешно отправлен в n8n!\nДействие: ${args.action}\nОтвет: ${typeof responseData === 'object' ? JSON.stringify(responseData, null, 2) : responseData}`
      }]
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Ошибка вызова вебхука n8n: ${error.message}` }] };
  }
}

// ---------- Контур Стадии 0: реестр (registry-api) + оракул (ADNA) ----------

const VERDICT_TEXT = {
  same: "⚠️ ТОТ ЖЕ ТРЕК (плагиат/копия) — минт блокируется, спор",
  derivative: "🔁 ПРОИЗВОДНАЯ РАБОТА — минт с пометкой derivative, нужно согласие исходного владельца",
  different: "✅ ДРУГОЙ ТРЕК — минт разрешён",
  empty: "📭 Реестр оракула пуст"
};

export async function handleIdentifyTrack(args) {
  try {
    if (args.adna || args.adna_v2) {
      const r = await oraclePost("/identify", {
        adna: args.adna || undefined,
        adna_v2: args.adna_v2 || undefined
      });
      const m = r.match;
      if (!m) return { content: [{ type: "text", text: `${VERDICT_TEXT[r.verdict] || r.verdict}` }] };
      // v2-детали: локализация и карта атрибуции (многосэмпельные треки)
      let loc = "";
      if (m.version === "v2") {
        loc = `\n📐 Локализация: оффсет ${m.offset_sec} с, покрытие запроса ${(100 * m.coverage_q).toFixed(0)}%` +
          (m.scale != null ? `, масштаб σ=${m.scale}, сдвиг бинов ${m.pitch_shift_bins >= 0 ? "+" : ""}${m.pitch_shift_bins}` : "");
        if (Array.isArray(m.attribution) && m.attribution.length > 1) {
          loc += `\n🧩 Атрибуция: ${m.attribution.map(a => `${a.isrc} ${(100 * a.share).toFixed(0)}%`).join(" | ")}`;
        }
      }
      let extra = "";
      try {
        const track = await registryGet(`/tracks/${m.isrc}`);
        extra = `\n\n🎼 В реестре: «${track.title}» — ${track.artist?.name || "?"}` +
          `\n📋 Сплиты: ${track.splits.map(s => `${s.role}/${s.wallet} ${s.share}%`).join(", ")}`;
      } catch { /* оракул знает трек, в реестре его нет — норм для Stage 0 */ }
      return {
        content: [{
          type: "text",
          text: `🔍 ИДЕНТИФИКАЦИЯ ADNA (${m.version || "v1"})\n\nСходство: ${m.similarity}\nВердикт: ${VERDICT_TEXT[m.verdict] || m.verdict}${loc}\n🎯 Матч: ${m.isrc} — ${m.artist} — ${m.title}${extra}`
        }]
      };
    }
    if (args.isrc) {
      const track = await registryGet(`/tracks/${args.isrc}`);
      return {
        content: [{
          type: "text",
          text: `🎵 ТРЕК В РЕЕСТРЕ (Стадия 0)\n\n🆔 ISRC: ${track.isrc}\n🎼 ${track.title} — ${track.artist?.name || "?"}` +
            `\n${track.parent_isrc ? `🔗 Производный от ${track.parent_isrc}` : "🔗 Оригинал"}` +
            `\n📋 Сплиты: ${track.splits.map(s => `${s.role}/${s.wallet} ${s.share}%`).join(", ")}`
        }]
      };
    }
    return { content: [{ type: "text", text: "⚠️ Укажите adna (идентификация через оракул) или isrc (данные из реестра)" }] };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Ошибка идентификации: ${error.message}` }] };
  }
}

export async function handleRegisterTrack(args) {
  try {
    const body = {
      isrc: args.isrc, title: args.title, adna: args.adna,
      adna_v2: args.adna_v2 || undefined,
      sha256: args.sha256, ndt: args.ndt, parent_isrc: args.parent_isrc,
      splits: args.splits
    };
    const reg = await registryPost("/tracks", body);
    // двойная запись (канон пилота): дубль в оракул для identify
    let oracle = "пропущен";
    try {
      oracle = await oraclePost("/register", {
        isrc: args.isrc, artist: args.artist_name || "", title: args.title,
        adna: args.adna, adna_v2: args.adna_v2 || undefined
      });
    } catch (e) {
      oracle = `ошибка: ${e.message}`;
    }
    return {
      content: [{
        type: "text",
        text: `✅ ТРЕК ЗАРЕГИСТРИРОВАН (Стадия 0)\n\n🆔 ISRC: ${reg.isrc}\n🎼 ${args.title}` +
          `${args.parent_isrc ? `\n🔗 Производный от ${args.parent_isrc}` : ""}` +
          `\n📋 Реестр: ok (artist_id=${reg.artist_id})\n🔮 Оракул: ${typeof oracle === "object" ? oracle.detail || "ok" : oracle}`
      }]
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Ошибка регистрации трека: ${error.message}` }] };
  }
}

export async function handleGetTrackManifest(args) {
  try {
    const track = await registryGet(`/tracks/${args.isrc}`);
    if (!track.ndt) {
      return { content: [{ type: "text", text: `📭 У трека ${args.isrc} нет NDT-манифеста (зарегистрирован без ndt)` }] };
    }
    let manifest = track.ndt;
    try { manifest = JSON.parse(track.ndt); } catch { /* уже строка */ }
    return {
      content: [{
        type: "text",
        text: `📄 NDT-МАНИФЕСТ ${args.isrc}\n\n` +
          (typeof manifest === "object"
            ? JSON.stringify(manifest, null, 2)
            : manifest)
      }]
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Ошибка получения манифеста: ${error.message}` }] };
  }
}

// ------------------- §7.7 фан-агент: аудитория по квитанциям ---------------
// Агентский JWT приходит аргументом вызова (артист выдаёт его через
// POST /subjects/{id}/scopes/issue); MCP-сервер хранит только транспортный
// MCP_API_KEY — креденция остаётся у артиста (human-in-the-loop).

export async function handleAudienceSuperfans(args) {
  try {
    if (!args.agent_token) {
      return { content: [{ type: "text", text: "⚠️ Нужен agent_token — агентский JWT из POST /subjects/{ndp_id}/scopes/issue (скоуп read_audience)" }] };
    }
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
    const data = await registryGet(
      `/agents/audience/superfans?limit=${limit}`, args.agent_token);
    if (!data.items?.length) {
      return { content: [{ type: "text", text: "📭 Подтверждённых слушателей пока нет — аудитория соберётся из квитанций §7.1" }] };
    }
    const rows = data.items.map((s, i) => {
      const medal = ["🥇", "🥈", "🥉"][i] || `${i + 1}.`;
      return `${medal} ${s.ndp_id}\n     прослушиваний: ${s.plays} | rewind'ов: ${s.rewinds} | поддержал: ${(s.amount_kopecks / 100).toFixed(2)} ₽ | дней: ${s.active_days} | был: ${s.last_seen}`;
    });
    return {
      content: [{
        type: "text",
        text: `🎧 СУПЕРФАНАТЫ (${data.total})\n\n${rows.join("\n")}`
      }]
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Аудитория недоступна: ${error.message}` }] };
  }
}

export async function handleAudienceSummary(args) {
  try {
    if (!args.agent_token) {
      return { content: [{ type: "text", text: "⚠️ Нужен agent_token — агентский JWT из POST /subjects/{ndp_id}/scopes/issue" }] };
    }
    const s = await registryGet("/agents/audience/summary", args.agent_token);
    return {
      content: [{
        type: "text",
        text: `📊 АУДИТОРИЯ (по квитанциям §7.1)\n\n` +
          `слушателей: ${s.listeners}\n` +
          `событий: ${s.events} (из них rewind'ов: ${s.rewinds})\n` +
          `поддержано: ${(s.amount_kopecks / 100).toFixed(2)} ₽\n` +
          `активных за 30 дней: ${s.active_listeners_30d}`
      }]
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Аудитория недоступна: ${error.message}` }] };
  }
}

// ---------------- §1: субъекты + §7.1: квитанции + стата -------------------

export async function handleSubjectMint(args) {
  try {
    const body = {
      verification_path: args.verification_path,
      identity_commitment: args.identity_commitment,
      initial_device_key: args.initial_device_key,
    };
    const r = await registryPost("/subjects/mint", body, args.authorization);
    const s = r.subject || {};
    return {
      content: [{
        type: "text",
        text: `🆔 ПАСПОРТ NDP СОЗДАН\n\n` +
          `ndp_id: ${s.ndp_id}\n` +
          `статус: ${s.status}\n` +
          `путь: ${s.verification_path}\n` +
          `карантин до: ${s.quarantine_until || "—"}\n` +
          `device-ключей: ${(s.keys || []).length}\n` +
          `SubjectRef: ${JSON.stringify(r.subject_ref || {})}`
      }]
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Минт паспорта: ${error.message}` }] };
  }
}

export async function handleSubjectStatus(args) {
  try {
    const r = await registryGet(`/subjects/${args.ndp_id}`);
    return {
      content: [{
        type: "text",
        text: `🪪 ПАСПОРТ ${args.ndp_id}\n\n` +
          `valid: ${r.valid ? "✅ да" : "⛔ нет"}\n` +
          `статус: ${r.status}\n` +
          `путь: ${r.verification_path}\n` +
          `создан: ${r.created_at}`
      }]
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Паспорт не найден: ${error.message}` }] };
  }
}

export async function handleSubjectKeys(args) {
  try {
    const r = await registryGet(`/subjects/${args.ndp_id}/keys`, args.authorization);
    const keys = (r.keys || r || []).map(k =>
      `  ${k.is_active ? "🟢" : "🔴"} ${k.public_key?.slice(0, 20)}… (квота ${k.daily_quota_limit}/сутки)`);
    return {
      content: [{
        type: "text",
        text: `🔑 КЛЮЧИ УСТРОЙСТВ (${(r.keys || []).length})\n\n${keys.join("\n")}`
      }]
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Ключи: ${error.message}` }] };
  }
}

export async function handleReceiptBatch(args) {
  try {
    if (!args.receipts || !Array.isArray(args.receipts) || !args.receipts.length) {
      return { content: [{ type: "text", text: "⚠️  Массив receipts пуст или отсутствует" }] };
    }
    const r = await registryPost("/subjects/receipts/batch", { receipts: args.receipts });
    const lines = r.results.map(x =>
      `  ${x.status === "accepted" ? "✅" : "⛔"} ${x.receipt_id} — ${x.status}${x.reason ? ` (${x.reason})` : ""}${x.event_id ? ` → event ${x.event_id}` : ""}`);
    return {
      content: [{
        type: "text",
        text: `🧾 КВИТАНЦИИ: принято ${r.accepted}, отклонено ${r.rejected} из ${r.results.length}\n\n${lines.join("\n")}`
      }]
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Квитанции: ${error.message}` }] };
  }
}

export async function handleStatsJournal(args) {
  try {
    const days = Math.min(Math.max(Number(args.days) || 30, 1), 365);
    const j = await registryGet(`/stats/journal?days=${days}`);
    const days_ = (j.days || []).map(d =>
      `  ${d.day} | ${d.action} | событий: ${d.events} | ${(d.amount_kopecks / 100).toFixed(2)} ₽`);
    const chart = (j.chart || []).slice(0, 10).map(c =>
      `  ${c.isrc} «${c.title}» — ${c.plays} прослушиваний, ${(c.amount_kopecks / 100).toFixed(2)} ₽`);
    return {
      content: [{
        type: "text",
        text: `📊 ЖУРНАЛ (${days} дн.)\n\nПо дням:\n${days_.join("\n") || "  пусто"}\n\nТоп треков:\n${chart.join("\n") || "  пусто"}`
      }]
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Журнал: ${error.message}` }] };
  }
}

export async function handleOptIn(args) {
  try {
    const r = await registryPost("/subjects/me/audience-opt-in",
      { enabled: args.enabled }, args.authorization);
    return {
      content: [{
        type: "text",
        text: `${r.audience_opt_in ? "👁 Оптин включён" : "🙈 Оптин выключен"} для ${r.ndp_id}`
      }]
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Оптин: ${error.message}` }] };
  }
}

export async function handleSnapshotEpoch(args) {
  try {
    const r = await registryGet("/subjects/snapshot");
    return {
      content: [{
        type: "text",
        text: `📸 EPOCH-СНАПШОТ\n\n` +
          `epoch: ${r.epoch}\n` +
          `root_hash: ${r.root_hash?.slice(0, 20)}…\n` +
          `субъектов: ${(r.entries || []).length}\n` +
          `подписант: ${r.signer}\n` +
          `сгенерирован: ${r.generated_at}`
      }]
    };
  } catch (error) {
    return { content: [{ type: "text", text: `❌ Снапшот: ${error.message}` }] };
  }
}
