const { Events, MessageFlags, EmbedBuilder, ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { loadGuildConfig, loadTribes, saveTribes, isPremium, getRegistrationState, updateRegistrationState, saveGuildConfig } = require('../utils/dataManager');
const { updateLog } = require('../utils/logger');
const { logToTribe } = require('../utils/tribeLog');
const { generateVoteEmbed } = require('../commands/tribu');
// Importamos finalizarRegistro para usarlo cuando la tribu acepta la solicitud
const { finalizarRegistro } = require('./messageCreate'); 

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        
        // Inicializar mapa de votos de sugerencias
        if (!interaction.client.suggestVotes) interaction.client.suggestVotes = new Map();
        
        // --- LICENCIAS ---
        if (interaction.guild && !isPremium(interaction.guild.id)) {
            const safeCommands = ['soporte', 'botinfo', 'adminlicense', 'syncchannels']; 
            if (interaction.commandName && !safeCommands.includes(interaction.commandName) && (interaction.isChatInputCommand() || interaction.isAutocomplete())) {
                // return interaction.reply({ content: '🔒 Bot sin licencia.', ephemeral: true });
            }
        }

        // --- COMANDOS ---
        if (interaction.isAutocomplete()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (command) try { await command.autocomplete(interaction); } catch (e) {}
            return;
        }

        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (command) try { await command.execute(interaction); } catch (e) {
                if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Error.', ephemeral: true });
            }
            return;
        }

        if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

        // ==================================================================
        // 1. REGISTRO: SOLICITUD DE INGRESO A TRIBU (join_)
        // ==================================================================
        if (interaction.isButton() && interaction.customId.startsWith('join_')) {
            await interaction.deferUpdate();
            
            const action = interaction.customId.split('_')[1]; // accept / deny
            const targetUserId = interaction.customId.split('_')[2];
            const regChannelId = interaction.customId.split('_')[3];

            const guild = interaction.guild;
            const regChannel = guild.channels.cache.get(regChannelId);

            // Verificar si el canal de registro existe
            if (!regChannel) {
                return interaction.followUp({ content: '❌ El usuario se ha ido o el canal ya no existe.', ephemeral: true });
            }

            // Verificar si sigue esperando (Paso 10)
            const state = getRegistrationState(regChannelId);
            if (!state || state.step !== 10) {
                return interaction.followUp({ content: '❌ Esta solicitud ha expirado o ya fue procesada.', ephemeral: true });
            }

            // --- ACEPTAR ---
            if (action === 'accept') {
                const targetMember = await guild.members.fetch(targetUserId).catch(()=>null);
                const config = loadGuildConfig(guild.id);
                
                if (targetMember) {
                    // Finalizar registro uniendo a la tribu existente (false = no es nueva)
                    await finalizarRegistro(targetMember, regChannel, state.data_id, state.data_tribe, config, false);
                }

                const embed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor('Green')
                    .setTitle('✅ Solicitud Aceptada')
                    .setDescription(`**${interaction.user.username}** ha aceptado a <@${targetUserId}>.`);
                
                await interaction.editReply({ components: [], embeds: [embed] });
            }

            // --- RECHAZAR ---
            if (action === 'deny') {
                // 1. Actualizar DB: Volver al Paso 2 (Pedir Tribu) y borrar la tribu guardada
                try {
                    updateRegistrationState(regChannelId, 2, undefined, null);
                } catch(e) { console.error("Error actualizando estado join_deny:", e); }
                
                // 2. Avisar al usuario en su canal para que escriba otro nombre
                await regChannel.send(`❌ **Solicitud Rechazada.**\nLa tribu **${state.data_tribe}** ha denegado tu ingreso.\n\n🛡️ Por favor, escribe **otro nombre de tribu** (o crea una nueva):`);

                // 3. Actualizar mensaje en el canal de la tribu
                const embed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor('Red')
                    .setTitle('❌ Solicitud Rechazada')
                    .setDescription(`**${interaction.user.username}** ha rechazado a <@${targetUserId}>.`);
                
                await interaction.editReply({ components: [], embeds: [embed] });
            }
            return;
        }

        // ==================================================================
        // 2. REGISTRO: CANCELAR SOLICITUD (Usuario se arrepiente)
        // ==================================================================
        if (interaction.isButton() && interaction.customId === 'reg_cancel_join') {
            await interaction.deferUpdate();
            
            const regChannelId = interaction.channel.id;
            const state = getRegistrationState(regChannelId);

            if (state && state.step === 10) {
                // Volver al Paso 2
                try {
                    updateRegistrationState(regChannelId, 2, undefined, null);
                } catch(e) { console.error("Error cancelando solicitud:", e); }
                
                await interaction.channel.send(`🔄 **Solicitud Cancelada.**\n\n🛡️ Escribe **otro nombre de tribu**:`);
                
                // Desactivar botón
                await interaction.editReply({ components: [] });
            }
            return;
        }

        // ==================================================================
        // 3. MERCADO (Tickets de Compra/Venta)
        // ==================================================================
        if (interaction.isButton() && interaction.customId.startsWith('market_contact_')) {
            await interaction.deferReply({ ephemeral: true });
            const sellerId = interaction.customId.split('_')[2];
            const buyerId = interaction.user.id;
            
            if (sellerId === buyerId) return interaction.editReply('❌ No puedes negociar contigo mismo.');

            const config = loadGuildConfig(interaction.guild.id);
            if (!config || !config.categories.market) return interaction.editReply('❌ Categoría Mercado no configurada.');

            const originalEmbed = interaction.message.embeds[0];
            const productName = originalEmbed.fields.find(f => f.name.includes('Artículo') || f.name.includes('Busco'))?.value || 'Item';
            const type = originalEmbed.title.includes('VENTA') ? 'Venta' : 'Compra';

            const channelName = `🤝・${type.substring(0,1)}-${productName.substring(0,5)}-${interaction.user.username.substring(0,5)}`.replace(/[^a-z0-9\-]/gi, '').toLowerCase();

            try {
                const tradeChannel = await interaction.guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    parent: config.categories.market,
                    topic: `MARKET | ITEM:${productName} | SELLER:${sellerId} | MSG:${interaction.message.id} | CH:${interaction.channelId}`,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: sellerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                        { id: buyerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                        { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel] }
                    ]
                });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('market_close_deal').setLabel('🔒 Cerrar Trato').setStyle(ButtonStyle.Danger)
                );

                await tradeChannel.send({
                    content: `<@${sellerId}> <@${buyerId}>`,
                    embeds: [new EmbedBuilder().setTitle('🤝 Negociación').setDescription(`Interesado en **${productName}**.\nHablad aquí.`).setColor('Gold')],
                    components: [row]
                });

                return interaction.editReply(`✅ Ticket creado: ${tradeChannel}`);
            } catch (e) { return interaction.editReply('❌ Error creando canal.'); }
        }

        if (interaction.isButton() && interaction.customId === 'market_close_deal') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('market_result_success').setLabel('✅ Éxito').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('market_result_fail').setLabel('❌ Cancelado').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ content: '¿Resultado?', components: [row] });
        }

        if (interaction.isButton() && interaction.customId.startsWith('market_result_')) {
            await interaction.deferUpdate();
            const isSuccess = interaction.customId === 'market_result_success';
            const topic = interaction.channel.topic || '';
            
            const originMsgId = topic.match(/MSG:(\d+)/)?.[1];
            const originChanId = topic.match(/CH:(\d+)/)?.[1];
            
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`market_final_keep_${originChanId}_${originMsgId}`).setLabel('🔄 Mantener Anuncio').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`market_final_delete_${originChanId}_${originMsgId}`).setLabel('🛑 Borrar Anuncio').setStyle(ButtonStyle.Danger)
            );

            await interaction.editReply({ content: isSuccess ? '🎉 **¡Trato cerrado!**' : '⚠️ **No hubo trato.**', components: [row] });
        }

        if (interaction.isButton() && interaction.customId.startsWith('market_final_')) {
            await interaction.deferUpdate();
            const action = interaction.customId.split('_')[2];
            const originChanId = interaction.customId.split('_')[3];
            const originMsgId = interaction.customId.split('_')[4];
            
            const originChan = interaction.guild.channels.cache.get(originChanId);
            if (originChan) {
                try {
                    const msg = await originChan.messages.fetch(originMsgId);
                    if (action === 'delete') await msg.delete();
                    else await msg.reply('🔄 Sigue disponible.');
                } catch (e) {}
            }
            await interaction.channel.delete();
        }

        // ==================================================================
        // 4. DIPLOMACIA (Alianzas)
        // ==================================================================
        if (interaction.isButton() && interaction.customId.startsWith('diplo_')) {
            await interaction.deferUpdate(); 
            const action = interaction.customId.split('_')[1]; 
            const requestingTribeName = interaction.customId.split('_')[2]; 
            const guild = interaction.guild;
            const tribes = loadTribes(guild.id);
            const config = loadGuildConfig(guild.id);

            let responderTribeName = null;
            let responderTribeData = null;

            for (const [name, data] of Object.entries(tribes)) {
                const member = data.members.find(m => m.discordId === interaction.user.id);
                if (member) {
                    responderTribeName = name; responderTribeData = data;
                    if (member.rango !== 'Líder') return interaction.followUp({ content: '❌ Solo Líder.', ephemeral: true });
                    break;
                }
            }

            if (!responderTribeData) return interaction.followUp({ content: '❌ Sin tribu.', ephemeral: true });
            const requestingTribeData = tribes[requestingTribeName];
            if (!requestingTribeData) return interaction.editReply({ content: '❌ Tribu solicitante no existe.', components: [] });

            if (action === 'deny') {
                const embed = new EmbedBuilder().setTitle('🕊️ Rechazada').setDescription(`**${responderTribeName}** rechazó la alianza.`).setColor('Red');
                await interaction.editReply({ content: null, embeds: [embed], components: [] });
                await logToTribe(guild, requestingTribeData, '❌ Rechazada', `**${responderTribeName}** denegó la alianza.`, 'Red');
                return;
            }

            if (action === 'accept') {
                const maxAlliances = config.limits?.max_alliances || 0;
                if (maxAlliances > 0 && (responderTribeData.alliances?.length || 0) >= maxAlliances) return interaction.followUp({ content: '❌ Límite de alianzas.', ephemeral: true });

                const catTribes = config.categories.tribes;
                const reqRole = guild.roles.cache.find(r => r.name === requestingTribeName);
                const resRole = guild.roles.cache.find(r => r.name === responderTribeName);
                const channelName = `🤝・${requestingTribeName.substring(0,6)}-${responderTribeName.substring(0,6)}`.toLowerCase().replace(/[^a-z0-9\-\u{1F91D}]/gu, '');
                
                try {
                    const allianceChannel = await guild.channels.create({
                        name: channelName, type: ChannelType.GuildText, parent: catTribes,
                        permissionOverwrites: [
                            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                            { id: reqRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                            { id: resRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                            { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel] }
                        ]
                    });

                    if (!requestingTribeData.alliances) requestingTribeData.alliances = [];
                    if (!responderTribeData.alliances) responderTribeData.alliances = [];
                    requestingTribeData.alliances.push(responderTribeName);
                    responderTribeData.alliances.push(requestingTribeName);

                    if (!requestingTribeData.allianceChannels) requestingTribeData.allianceChannels = [];
                    requestingTribeData.allianceChannels.push({ with: responderTribeName, channelId: allianceChannel.id });

                    saveTribes(guild.id, tribes);

                    await allianceChannel.send(`🤝 **Alianza Formada**\nBienvenidos al canal compartido.`);
                    const embed = new EmbedBuilder().setTitle('🕊️ Aceptada').setDescription(`Ahora sois aliados de **${requestingTribeName}**.`).setColor('Green');
                    await interaction.editReply({ content: null, embeds: [embed], components: [] });
                    await logToTribe(guild, requestingTribeData, '✅ Aceptada', `**${responderTribeName}** aceptó la alianza. Canal: ${allianceChannel}`, 'Green');
                } catch (e) { return interaction.followUp({ content: '❌ Error canal.', ephemeral: true }); }
            }
            return;
        }

        // ==================================================================
        // 5. SUGERENCIAS Y TICKETS SIMPLES
        // ==================================================================
        if (interaction.isButton() && interaction.customId.startsWith('suggest_vote_')) {
            const voteId = `${interaction.guild.id}:${interaction.message.id}`;
            const voteData = interaction.client.suggestVotes?.get(voteId);
            if (!voteData) return interaction.reply({ content: '❌ Voto expirado.', ephemeral: true });
            if (voteData.voters.has(interaction.user.id)) return interaction.reply({ content: '❌ Ya votaste.', ephemeral: true });
            
            await interaction.deferUpdate();
            if (interaction.customId === 'suggest_vote_yes') voteData.yes++; else voteData.no++;
            voteData.voters.add(interaction.user.id);
            
            const embed = EmbedBuilder.from(interaction.message.embeds[0]).setFields(
                interaction.message.embeds[0].fields[0], interaction.message.embeds[0].fields[1],
                { name: '📊', value: `Sí: ${voteData.yes} | No: ${voteData.no}`, inline: false }
            );
            await interaction.message.edit({ embeds: [embed] });
            interaction.client.suggestVotes.set(voteId, voteData);
        }

        if (interaction.isButton() && interaction.customId === 'create_ticket') {
            try {
                await interaction.deferReply({ ephemeral: true });
                const name = `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
                if (interaction.guild.channels.cache.find(c => c.name === name)) return interaction.followUp('❌ Ya tienes ticket.');
                
                const ch = await interaction.guild.channels.create({
                    name: name, type: ChannelType.GuildText, parent: interaction.channel.parentId,
                    permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel] }]
                });
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Cerrar').setStyle(ButtonStyle.Danger));
                await ch.send({ content: `${interaction.user}`, embeds: [new EmbedBuilder().setTitle('Ticket').setDescription('Describe tu problema.').setColor('Green')], components: [row] });
                return interaction.followUp(`✅ ${ch}`);
            } catch (e) { return interaction.followUp('❌ Error ticket.'); }
        }

        if (interaction.isButton() && interaction.customId === 'close_ticket') {
            if (!interaction.channel.name.startsWith('ticket-')) return;
            await interaction.reply('🔒 Cerrando...');
            setTimeout(() => interaction.channel.delete().catch(()=>{}), 5000);
        }
        
        // ==================================================================
        // 6. VOTACIÓN TRIBU
        // ==================================================================
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('tribe_vote_')) {
            try {
                const tribeName = interaction.customId.split('_')[2];
                const candidateId = interaction.values[0];
                await interaction.deferReply({ ephemeral: true });
                const tribes = loadTribes(interaction.guild.id);
                const tData = tribes[tribeName];
                if (!tData) return interaction.followUp('❌ Error tribu.');
                
                if (!tData.votes) tData.votes = {};
                tData.votes[interaction.user.id] = candidateId;
                
                const votes = Object.values(tData.votes).filter(id => id === candidateId).length;
                if (votes >= Math.floor(tData.members.length / 2) + 1) {
                    tData.members.forEach(m => { if (m.rango === 'Líder') m.rango = 'Miembro'; });
                    const winner = tData.members.find(m => m.discordId === candidateId);
                    if (winner) winner.rango = 'Líder';
                    tData.votes = {};
                    saveTribes(interaction.guild.id, tribes);
                    interaction.channel.send(`👑 **Nuevo Líder:** <@${candidateId}>`);
                    return interaction.deleteReply();
                }
                saveTribes(interaction.guild.id, tribes);
                return interaction.followUp('✅ Votado.');
            } catch (e) {}
        }
    },
};