const { Events, EmbedBuilder, ChannelType } = require('discord.js');
const { loadTribes, saveTribes, loadGuildConfig, isPermabanned } = require('../utils/dataManager');
const { updateLog } = require('../utils/logger');
const { BAN_THRESHOLD } = require('../utils/constants');
const { createCompositeImage } = require('../utils/imageMaker'); // Asegúrate de que esto sigue aquí

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member) {
        const guild = member.guild;
        const config = loadGuildConfig(guild.id);
        if (!config) return;

        // ==================================================================
        // 1. LIMPIEZA DE CANAL DE REGISTRO (SOLUCIÓN A TU PROBLEMA)
        // ==================================================================
        // Buscamos cualquier canal que pertenezca a este usuario
        // Estrategia A: Por TOPIC (La más precisa con el nuevo sistema)
        let regChannel = guild.channels.cache.find(c => 
            c.type === ChannelType.GuildText && 
            c.topic && 
            c.topic.includes(`USER:${member.id}`)
        );

        // Estrategia B: Por Nombre/Categoría (Fallback por si el topic fallara)
        if (!regChannel && config.categories.private_registration) {
            const suffix = member.id.slice(-4);
            regChannel = guild.channels.cache.find(c => 
                c.parentId === config.categories.private_registration && 
                c.name.includes('registro') && 
                c.name.includes(suffix)
            );
        }

        // SI EXISTE EL CANAL, LO BORRAMOS
        if (regChannel) {
            console.log(`👋 Usuario ${member.user.tag} abandonó durante el registro. Borrando canal: ${regChannel.name}`);
            await regChannel.delete('Usuario abandonó el servidor (Limpieza Automática)').catch(e => console.error('Error borrando canal registro:', e.message));
        }
        // ==================================================================


        // 2. Detectar Estado (Ban vs Salida Voluntaria)
        let tribes = loadTribes(guild.id);
        let saved = false;
        
        let wasBanned = false;
        let banReason = 'Salida Voluntaria'; 
        let tribeName = null;
        let tribeData = null; 

        // Check Permaban
        const permabanInfo = isPermabanned(guild.id, member.id);
        if (permabanInfo) {
            wasBanned = true;
            banReason = `⛔ Permaban: ${permabanInfo.reason}`;
        }

        // Check Tribus & Warns
        for (const tName in tribes) {
            const t = tribes[tName];
            const idx = t.members.findIndex(m => m.discordId === member.id);
            
            if (idx !== -1) {
                tribeName = tName;
                tribeData = t;
                
                const totalWarns = (t.members[idx].warnings || 0) + (t.warnings || 0);
                if (!wasBanned && totalWarns >= BAN_THRESHOLD) {
                    wasBanned = true;
                    banReason = 'Acumulación de Warns (Automático)';
                }

                t.members.splice(idx, 1);
                saved = true;

                if (t.members.length === 0) {
                    guild.roles.cache.find(r => r.name === tName)?.delete().catch(()=>{});
                    guild.channels.cache.get(t.channelId)?.delete().catch(()=>{});
                    delete tribes[tName];
                    tribeData = null;
                }
                break;
            }
        }

        if (saved) {
            saveTribes(guild.id, tribes);
            updateLog(guild, member.client);
        }

        const tribeDisplay = tribeName || 'Sin Tribu';
        const byeChan = guild.channels.cache.get(config.channels.goodbye);
        const banChan = guild.channels.cache.get(config.channels.ban_notifications);

        // ==================================================================
        // DISEÑO A: BANEO (IMAGEN ROJA)
        // ==================================================================
        if (wasBanned && banChan) {
            try {
                const banAttachment = await createCompositeImage(guild, member.user, 'ban');
                const banEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle(`🚫 REPORTE DE EXPULSIÓN`)
                    .setDescription(`**${member.user.tag}** ha sido eliminado permanentemente del servidor.`)
                    .addFields(
                        { name: '👤 Usuario', value: `${member.user.username}\n\`${member.id}\``, inline: true },
                        { name: '🛡️ Afiliación', value: tribeDisplay, inline: true },
                        { name: '📉 Causa', value: `\`${banReason}\``, inline: false },
                        { name: '👥 Población Restante', value: `${guild.memberCount} supervivientes`, inline: false }
                    )
                    .setImage('attachment://ban-image.png') 
                    .setFooter({ text: 'Sistema de Justicia Automático • BotArk', iconURL: guild.iconURL() })
                    .setTimestamp();
                
                await banChan.send({ embeds: [banEmbed], files: [banAttachment] });
            } catch (e) { console.error(e); }
        }

        // ==================================================================
        // DISEÑO B: SALIDA (IMAGEN AZUL/GRIS)
        // ==================================================================
        if (byeChan) {
            const color = wasBanned ? '#000000' : '#3498DB'; 
            const title = wasBanned ? '💀 Un traidor ha caído...' : '🍂 Un Superviviente ha partido...';
            const desc = wasBanned 
                ? `**${member.user.tag}** ha sido expulsado por la administración.` 
                : `**${member.user.tag}** ha decidido abandonar la isla de **${guild.name}**.`;

            try {
                const goodbyeAttachment = await createCompositeImage(guild, member.user, 'goodbye');
                const byeEmbed = new EmbedBuilder()
                    .setColor(color)
                    .setTitle(title)
                    .setDescription(desc)
                    .addFields(
                        { name: '👤 Usuario', value: `${member.user.tag}`, inline: true },
                        { name: '🛡️ Antigua Tribu', value: tribeDisplay, inline: true },
                        { name: '👥 Supervivientes', value: `${guild.memberCount}`, inline: true }
                    )
                    .setImage('attachment://goodbye-image.png')
                    .setFooter({ text: wasBanned ? 'Justicia Impartida.' : `Esperamos verte de nuevo, ${member.user.username}.` })
                    .setTimestamp();

                await byeChan.send({ embeds: [byeEmbed], files: [goodbyeAttachment] });
            } catch (e) { console.error(e); }
        }

        // ==================================================================
        // DISEÑO C: AVISO TRIBU (Privado - Texto)
        // ==================================================================
        if (tribeData && tribeData.channelId) {
            const tribeChannel = guild.channels.cache.get(tribeData.channelId);
            if (tribeChannel) {
                const tribeEmbed = new EmbedBuilder()
                    .setTitle(wasBanned ? '🚨 ALERTA DE SEGURIDAD' : 'ℹ️ INFORME DE PERSONAL')
                    .setColor(wasBanned ? 'DarkRed' : 'Orange')
                    .setThumbnail(member.user.displayAvatarURL())
                    .setDescription(wasBanned 
                        ? `Vuestro compañero **${member.user.username}** ha sido **BANEADO** del servidor.` 
                        : `Vuestro compañero **${member.user.username}** ha abandonado la tribu y el servidor.`)
                    .addFields({ name: '📝 Detalle', value: wasBanned ? banReason : 'Salida voluntaria' })
                    .setTimestamp();

                await tribeChannel.send({ embeds: [tribeEmbed] }).catch(() => {});
            }
        }
    },
};
