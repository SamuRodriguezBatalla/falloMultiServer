const { Events, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { loadTribes, saveTribes, loadGuildConfig, getAllPremiumGuilds, updateLastAlert, getGameBans, removeGameBan, getRegistrationState } = require('../utils/dataManager');
const { updateLog } = require('../utils/logger');
const { sendRconCommand } = require('../utils/rconManager');

const MAINTENANCE_INTERVAL = 5 * 60 * 1000; 
const MAX_REGISTRATION_AGE = 60 * 60 * 1000; 

let isSyncing = false;

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`✅ Bot Online: ${client.user.tag} - Sistema V15 (Waiting Protection).`);
        runMaintenance(client);
        setInterval(() => runMaintenance(client), MAINTENANCE_INTERVAL);
    },
};

async function runMaintenance(client) {
    if (isSyncing) return;
    isSyncing = true;

    for (const guild of client.guilds.cache.values()) {
        try {
            const config = loadGuildConfig(guild.id);
            if (!config) continue;

            await autoAssignRoles(guild, config);
            
            // SINCRONIZACIÓN DESACTIVADA (Para evitar bucles)
            // await sincronizarRegistros(guild, config);

            await checkTribes(guild, config, client);
            await checkRegistrationTimeouts(guild, config);
            await checkGameBans(guild);

        } catch (e) {
            console.error(`Error mantenimiento en ${guild.name}:`, e.message);
        }
    }
    await checkPayments(client);
    isSyncing = false;
}

async function autoAssignRoles(guild, config) {
    const unverifiedRole = guild.roles.cache.get(config.roles.unverified);
    if (!unverifiedRole) return;
    try {
        let members = guild.members.cache;
        try { members = await guild.members.fetch({ time: 5000 }); } catch (e) {}
        const targets = members.filter(m => {
            if (m.user.bot) return false;
            if (m.permissions.has(PermissionFlagsBits.Administrator)) return false;
            const hasSys = [config.roles.unverified, config.roles.survivor, config.roles.leader].some(id => m.roles.cache.has(id));
            return !hasSys;
        });
        if (targets.size > 0) {
            for (const [id, member] of targets) {
                await member.roles.add(unverifiedRole).catch(() => {});
                await new Promise(r => setTimeout(r, 500));
            }
        }
    } catch (e) {}
}

async function checkTribes(guild, config, client) {
    let tribes = loadTribes(guild.id);
    let modified = false;
    const now = Date.now();
    const MS_TO_WARN = 6 * 24 * 60 * 60 * 1000;
    const MS_TO_DELETE = 7 * 24 * 60 * 60 * 1000;
    const toDelete = [];
    const logChannel = config.channels.checkin_log ? guild.channels.cache.get(config.channels.checkin_log) : null;

    for (const [tName, tData] of Object.entries(tribes)) {
        const diff = now - (tData.lastActive || 0);
        if (tData.channelId && diff >= MS_TO_WARN && diff < MS_TO_WARN + MAINTENANCE_INTERVAL) {
            const ch = guild.channels.cache.get(tData.channelId);
            if (ch) ch.send({ embeds: [new EmbedBuilder().setTitle('⚠️ AVISO DE INACTIVIDAD').setDescription('Usad `/tribu checkin`.').setColor('Red')] }).catch(()=>{});
        }
        if (diff > MS_TO_DELETE) toDelete.push(tName);
    }

    for (const tName of toDelete) {
        const t = tribes[tName];
        if (t.channelId) guild.channels.cache.get(t.channelId)?.delete('Inactividad tribu').catch(()=>{});
        const role = guild.roles.cache.find(r => r.name === tName);
        if (role) role.delete().catch(()=>{});
        if (logChannel) logChannel.send({ embeds: [new EmbedBuilder().setDescription(`💀 **${tName}** eliminada por inactividad.`).setColor('Red')] }).catch(()=>{});
        delete tribes[tName];
        modified = true;
    }
    if (modified) { saveTribes(guild.id, tribes); await updateLog(guild, client); }
}

// --- 3. RECOLECTOR DE BASURA (CON PROTECCIÓN DE ESPERA) ---
async function checkRegistrationTimeouts(guild, config) {
    const privateCatId = config.categories.private_registration;
    if (!privateCatId) return;
    const category = guild.channels.cache.get(privateCatId);
    if (!category) return;
    const now = Date.now();
    const regChannels = category.children.cache.filter(c => c.type === ChannelType.GuildText && c.name.includes('registro'));

    for (const [id, channel] of regChannels) {
        
        // 🛡️ PROTECCIÓN: Si está esperando a la tribu (Paso 10), NO BORRAR
        const state = getRegistrationState(channel.id);
        if (state && state.step === 10) {
            continue;
        }

        const lastMessage = channel.lastMessageId ? await channel.messages.fetch(channel.lastMessageId).catch(() => null) : null;
        const lastActivity = lastMessage ? lastMessage.createdTimestamp : channel.createdTimestamp;
        
        if (now - lastActivity > MAX_REGISTRATION_AGE) {
            let userId = null;
            if (channel.topic && channel.topic.includes('USER:')) {
                const match = channel.topic.match(/USER:(\d+)/);
                if (match) userId = match[1];
            }
            if (userId) {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    let dmSent = false;
                    try {
                        await member.send({ embeds: [new EmbedBuilder().setTitle('⏳ Registro Cancelado').setColor('Red').setDescription('Tu canal se cerró por inactividad (1h).').addFields({ name: '🔄 ¿Cómo volver?', value: 'Escribe en cualquier chat del servidor.' }).setFooter({ text: guild.name })] });
                        dmSent = true;
                    } catch (e) { dmSent = false; }

                    if (!dmSent && config.channels.error_log) {
                        const errorChan = guild.channels.cache.get(config.channels.error_log);
                        if (errorChan) errorChan.send({ content: `${member}`, embeds: [new EmbedBuilder().setTitle('⚠️ Registro Caducado').setColor('Orange').setDescription(`El registro de **${member.user.tag}** expiró y tiene los MD cerrados.`).setTimestamp()] });
                    }
                }
            }
            await channel.delete('Inactividad').catch(e => console.error(`Error borrando ${channel.name}:`, e.message));
        }
    }
}

async function checkGameBans(guild) {
    const bans = getGameBans(guild.id);
    const now = Date.now();
    for (const ban of bans) {
        if (ban.ban_type === 'horas' && ban.unban_time > 0 && now >= ban.unban_time) {
            const rconRes = await sendRconCommand(guild.id, `UnbanPlayer "${ban.ark_id}"`);
            if (rconRes.success) {
                removeGameBan(guild.id, ban.ark_id);
                if (ban.discord_id) {
                    try {
                        const user = await guild.client.users.fetch(ban.discord_id);
                        await user.send({ embeds: [new EmbedBuilder().setTitle('🦖 Baneo de Ark Finalizado').setColor('Green').setDescription(`Tu sanción en **${guild.name}** ha expirado.`).setTimestamp()] });
                    } catch (e) {}
                }
            }
        }
    }
}

async function checkPayments(client) {
    try {
        const alertChannel = client.channels.cache.find(c => c.name === '🔔・alertas-pagos');
        if (!alertChannel) return;
        const premiumGuilds = getAllPremiumGuilds();
        const now = Date.now();
        for (const pg of premiumGuilds) {
            if (pg.is_unlimited === 1) continue; 
            const days = Math.floor((now - pg.added_at) / 86400000);
            if (days > 0 && days % 30 === 0 && (now - pg.last_alert > 86400000)) {
                await alertChannel.send(`💰 **COBRO PENDIENTE:** Cliente ${pg.client_name} (ID: ${pg.guild_id}) - Lleva ${days} días activo.`);
                updateLastAlert(pg.guild_id);
            }
        }
    } catch (e) {}
}
