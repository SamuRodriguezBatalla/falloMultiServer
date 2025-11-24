const { Events, EmbedBuilder, ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { loadGuildConfig, loadTribes, saveTribes, saveGuildConfig, getRegistrationState, updateRegistrationState, deleteRegistrationState } = require('../utils/dataManager');
const { updateLog } = require('../utils/logger');
const { createCompositeImage } = require('../utils/imageMaker');
const { updateTribePanel } = require('../utils/tribePanel');
const { generateTribeHelpEmbed } = require('../utils/helpGenerator');

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot || !message.guild) return;

        const channel = message.channel;
        // Solo procesamos si es un canal de registro activo (tiene estado en DB)
        let state = null;
        try { state = getRegistrationState(channel.id); } catch (e) {}

        if (!state) return; // No es canal de registro o no tiene estado

        const member = message.member;
        const config = loadGuildConfig(message.guild.id);
        if (!config) return;

        // Seguridad: Solo el dueño
        if (message.author.id !== state.user_id && !member.permissions.has(PermissionFlagsBits.Administrator)) return;

        const content = message.content.trim();
        const lowerContent = content.toLowerCase();

        // ==================================================================
        // 🛑 PASO 10: ESTADO DE ESPERA (CONGELADO)
        // ==================================================================
        if (state.step === 10) {
            // El usuario está esperando aprobación. Ignoramos lo que escriba.
            // Opcional: Borrar su mensaje para mantener limpio el canal.
            try { await message.delete(); } catch(e){}
            return;
        }

        // ==================================================================
        // PASO 1: RECIBIR ID PLATAFORMA
        // ==================================================================
        if (state.step === 1) {
            try { updateRegistrationState(channel.id, 2, content, undefined); } catch(e) {}
            await channel.send(`✅ ID Guardado: **${content}**\n\n🛡️ Ahora escribe el **nombre de tu Tribu**:\n*(Si la tribu ya existe, te preguntaré si quieres unirte)*.`);
            return;
        }

        // ==================================================================
        // PASO 2: RECIBIR NOMBRE DE TRIBU
        // ==================================================================
        if (state.step === 2) {
            const tribes = loadTribes(message.guild.id);
            const inputTribe = content;

            // A) LA TRIBU YA EXISTE
            if (tribes[inputTribe]) {
                // Guardamos el nombre temporalmente y vamos al Paso 3 (Decisión)
                try { updateRegistrationState(channel.id, 3, undefined, inputTribe); } catch(e) {}
                await channel.send(`ℹ️ La tribu **${inputTribe}** ya existe.\n¿Quieres solicitar unirte a ella? (Escribe **Si** o **No**)`);
                return;
            } 
            
            // B) LA TRIBU ES NUEVA -> Ir a Confirmación de Creación (Paso 4)
            else {
                try { updateRegistrationState(channel.id, 4, undefined, inputTribe); } catch(e) {}
                sendConfirmationSummary(channel, state.data_id, inputTribe, "Crear Nueva Tribu");
                return;
            }
        }

        // ==================================================================
        // PASO 3: DECISIÓN ¿UNIRSE A EXISTENTE?
        // ==================================================================
        if (state.step === 3) {
            const yesWords = ['si', 'yes', 's', 'y'];
            const noWords = ['no', 'n'];

            // USUARIO DICE SÍ (Quiere unirse)
            if (yesWords.includes(lowerContent)) {
                const tribes = loadTribes(message.guild.id);
                const targetTribe = tribes[state.data_tribe]; // El nombre se guardó en el paso anterior
                const maxMembers = config.limits?.max_tribe_members || 0;

                // 1. Comprobar Existencia (Por si se borró en el intermedio)
                if (!targetTribe) {
                    await channel.send(`❌ Error: La tribu **${state.data_tribe}** ha dejado de existir. Escribe otro nombre.`);
                    try { updateRegistrationState(channel.id, 2, undefined, null); } catch(e) {}
                    return;
                }

                // 2. Comprobar Límite
                if (maxMembers > 0 && targetTribe.members.length >= maxMembers) {
                    await channel.send(`❌ La tribu **${state.data_tribe}** está llena (${targetTribe.members.length}/${maxMembers}).\n🔄 Por favor, escribe otro nombre de tribu.`);
                    try { updateRegistrationState(channel.id, 2, undefined, null); } catch(e) {}
                    return;
                }

                // 3. ENVIAR SOLICITUD Y CONGELAR (Paso 10)
                const tribeChannel = message.guild.channels.cache.get(targetTribe.channelId);
                
                if (!tribeChannel) {
                    // Si la tribu no tiene canal (error raro), no se puede pedir permiso.
                    // Fallback: Unir directamente o dar error. Daremos error para seguridad.
                    await channel.send(`⚠️ La tribu **${state.data_tribe}** no tiene canal de comunicación configurado. Contacta a un admin.`);
                    return;
                }

                // Enviar Petición a la Tribu
                const requestEmbed = new EmbedBuilder()
                    .setTitle('📨 Solicitud de Ingreso')
                    .setColor('Blue')
                    .setDescription(`El usuario **${member.user.tag}** (ID: ${state.data_id}) solicita unirse a vuestra tribu.`)
                    .addFields({ name: 'Acción Requerida', value: 'Cualquier miembro de la tribu puede aceptar o rechazar.' })
                    .setTimestamp();

                const rowTribe = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`join_accept_${member.id}_${channel.id}`).setLabel('✅ Aceptar').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`join_deny_${member.id}_${channel.id}`).setLabel('❌ Rechazar').setStyle(ButtonStyle.Danger)
                );

                await tribeChannel.send({ content: '@here', embeds: [requestEmbed], components: [rowTribe] });

                // Actualizar Estado Usuario -> 10 (ESPERANDO)
                try { updateRegistrationState(channel.id, 10, undefined, undefined); } catch(e) {}

                // Mensaje al Usuario con Botón de Cancelar
                const cancelRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('reg_cancel_join').setLabel('Cancelar Solicitud').setStyle(ButtonStyle.Secondary)
                );

                await channel.send({ 
                    content: `⏳ **Solicitud enviada a ${state.data_tribe}.**\nTu canal permanecerá abierto indefinidamente hasta que respondan.\nSi te has equivocado, pulsa cancelar.`,
                    components: [cancelRow] 
                });
                return;
            }

            // USUARIO DICE NO (No quiere unirse, quiere otro nombre)
            else if (noWords.includes(lowerContent)) {
                await channel.send(`🔄 Vale. Escribe **otro nombre de tribu** diferente:`);
                try { updateRegistrationState(channel.id, 2, undefined, null); } catch(e) {}
                return;
            }

            else {
                await channel.send(`⚠️ Respuesta no válida. ¿Quieres unirte a **${state.data_tribe}**? Escribe **Si** o **No**.`);
                return;
            }
        }

        // ==================================================================
        // PASO 4: CONFIRMACIÓN DE CREACIÓN (RESUMEN)
        // ==================================================================
        if (state.step === 4) {
            const yesWords = ['si', 'yes', 's', 'y', 'correcto', 'confirmar'];
            const noWords = ['no', 'n', 'mal', 'error', 'corregir'];

            if (yesWords.includes(lowerContent)) {
                // CREAR TRIBU Y FINALIZAR
                await finalizarRegistro(member, channel, state.data_id, state.data_tribe, config, true); // true = es nueva tribu
            } 
            else if (noWords.includes(lowerContent)) {
                await channel.send(`❓ ¿Qué dato es incorrecto? Escribe **id** o **tribu**:`);
                try { updateRegistrationState(channel.id, 5, undefined, undefined); } catch(e) {}
            }
            else {
                // Atajos directos
                if (lowerContent.includes('id')) {
                    await channel.send(`✏️ Escribe tu nuevo **ID de Plataforma**:`);
                    try { updateRegistrationState(channel.id, 1, null, undefined); } catch(e) {}
                } else if (lowerContent.includes('tribu')) {
                    await channel.send(`✏️ Escribe el nuevo **nombre de Tribu**:`);
                    try { updateRegistrationState(channel.id, 2, undefined, null); } catch(e) {}
                } else {
                    await channel.send(`⚠️ Escribe **Si** para confirmar o **No** para corregir.`);
                }
            }
            return;
        }

        // ==================================================================
        // PASO 5: SELECCIÓN DE CORRECCIÓN
        // ==================================================================
        if (state.step === 5) {
            if (lowerContent.includes('id') || lowerContent.includes('plataforma')) {
                await channel.send(`✏️ Escribe tu nuevo **ID de Plataforma**:`);
                try { updateRegistrationState(channel.id, 1, null, undefined); } catch(e) {}
            } else if (lowerContent.includes('tribu') || lowerContent.includes('nombre')) {
                await channel.send(`✏️ Escribe el nuevo **nombre de Tribu**:`);
                try { updateRegistrationState(channel.id, 2, undefined, null); } catch(e) {}
            } else {
                await channel.send(`⚠️ Opción no reconocida. Escribe "id" o "tribu".`);
            }
            return;
        }
    },
};

// Helper para mostrar el resumen
async function sendConfirmationSummary(channel, id, tribe, title) {
    const summaryEmbed = new EmbedBuilder()
        .setTitle(`📋 ${title}`)
        .setColor('Gold')
        .setDescription(`Verifica que tus datos sean correctos.`)
        .addFields(
            { name: '🎮 ID Plataforma', value: id || '?', inline: true },
            { name: '🛡️ Tribu', value: tribe, inline: true }
        )
        .setFooter({ text: 'Escribe "si" para confirmar o "no" para corregir.' });
    await channel.send({ embeds: [summaryEmbed] });
}

// HELPER FINALIZAR (Exportado o local)
async function finalizarRegistro(member, channel, idPlay, tName, config, isNewTribe) {
    try { deleteRegistrationState(channel.id); } catch(e) {}
    await channel.send(`✅ **¡Registro Completado!** Procesando...`);

    const guild = member.guild;
    let tribes = loadTribes(guild.id);
    let tData = tribes[tName];
    let tRole = guild.roles.cache.find(r => r.name === tName);

    // Si es nueva, crear todo
    if (isNewTribe || !tData) {
        if (!tRole) tRole = await guild.roles.create({ name: tName, color: 'Random', reason: 'Registro BotArk' });
        let tCatId = config.categories.tribes;
        const tChan = await guild.channels.create({ 
            name: tName, type: ChannelType.GuildText, parent: tCatId, 
            permissionOverwrites: [{ id: guild.id, deny: [1024n] }, { id: tRole.id, allow: [1024n, 2048n] }, { id: member.client.user.id, allow: [1024n] }] 
        });
        tData = { members: [], warnings: 0, channelId: tChan.id, instructionMessageId: null, lastActive: Date.now(), alliances: [], allianceChannels: [] };
        tribes[tName] = tData; await channel.send(`✅ Tribu **${tName}** creada.`);
    }

    // Asignar Roles
    const rank = (tData.members.length === 0) ? 'Líder' : 'Miembro'; // Si entra a existente, es Miembro
    if (tRole) await member.roles.add(tRole).catch(()=>{});
    const survivorRole = guild.roles.cache.get(config.roles.survivor);
    if (survivorRole) await member.roles.add(survivorRole).catch(()=>{});
    const unverifiedRole = guild.roles.cache.get(config.roles.unverified);
    if (unverifiedRole) await member.roles.remove(unverifiedRole).catch(()=>{});
    if (rank === 'Líder') { const lRole = guild.roles.cache.get(config.roles.leader); if (lRole) await member.roles.add(lRole).catch(()=>{}); }

    tData.members.push({ username: member.user.username, idPlay: idPlay, discordId: member.id, hasKit: false, warnings: 0, rango: rank });
    saveTribes(guild.id, tribes); 
    
    await updateLog(guild, member.client);
    await updateTribePanel(guild, tName);

    // Bienvenida
    const welcomeChan = guild.channels.cache.get(config.channels.welcome);
    if (welcomeChan) {
        try {
            const welcomeAttachment = await createCompositeImage(guild, member.user, 'welcome');
            const welcomeEmbed = new EmbedBuilder()
                .setColor('#9B59B6') 
                .setTitle(`🦕 Nuevo Superviviente Registrado`)
                .setDescription(`¡Demos una cálida bienvenida a **${member.user.username}**!`)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
                .addFields(
                    { name: '👤 Superviviente', value: `${member}`, inline: true },
                    { name: '🎮 ID Plataforma', value: `\`${idPlay}\``, inline: true },
                    { name: '🛡️ Tribu', value: `**${tName}**`, inline: true }
                )
                .setFooter({ text: `${member.client.user.username} • Sistema de Acceso`, iconURL: guild.iconURL() })
                .setTimestamp();
            
            if (welcomeAttachment) {
                welcomeEmbed.setImage('attachment://welcome-image.png');
                await welcomeChan.send({ content: `¡Hola ${member}!`, embeds: [welcomeEmbed], files: [welcomeAttachment] });
            } else {
                await welcomeChan.send({ content: `¡Hola ${member}!`, embeds: [welcomeEmbed] });
            }
        } catch (e) {}
    }

    await channel.send(`👋 **Todo listo.** Cerrando canal...`);
    setTimeout(async () => { try { if (channel) await channel.delete(); } catch (e) {} }, 5000);
}

// Exportamos finalizarRegistro para usarla en interactionCreate también
module.exports.finalizarRegistro = finalizarRegistro;
