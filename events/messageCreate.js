const { Events, EmbedBuilder, ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { loadGuildConfig, loadTribes, saveTribes, getRegistrationState, updateRegistrationState, deleteRegistrationState } = require('../utils/dataManager');
const { updateLog } = require('../utils/logger');
const { createCompositeImage } = require('../utils/imageMaker');
const { updateTribePanel } = require('../utils/tribePanel');
const { iniciarRegistro } = require('./guildMemberAdd'); // Importante para re-iniciar si hace falta

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        // 0. Validaciones básicas
        if (message.author.bot || !message.guild) return;

        const member = message.member;
        if (!member) return; // Si el miembro no está cacheado

        const guild = message.guild;
        const config = loadGuildConfig(guild.id);
        if (!config) return;

        // ==================================================================
        // 👮 EL PORTERO (RESTRICCIÓN DE CHAT) - BLOQUE DE SEGURIDAD
        // ==================================================================
        const unverifiedRole = guild.roles.cache.get(config.roles.unverified);
        
        // Verificar inmunidad (Admins/Staff/Dueño)
        const isImmune = 
            member.id === guild.ownerId ||
            member.permissions.has(PermissionFlagsBits.Administrator) ||
            (config.roles.admin && member.roles.cache.has(config.roles.admin)) ||
            (config.roles.staff && member.roles.cache.has(config.roles.staff));

        // Si tiene rol No Verificado Y NO es inmune...
        if (unverifiedRole && member.roles.cache.has(unverifiedRole.id) && !isImmune) {
            
            // Validar si es SU canal de registro (por topic o nombre)
            const isMyRegChannel = 
                (message.channel.topic && message.channel.topic.includes(`USER:${member.id}`)) ||
                (message.channel.name.includes(`registro`) && message.channel.name.includes(member.id.slice(-4)));

            if (!isMyRegChannel) {
                // 🔥 BORRAR MENSAJE INMEDIATAMENTE
                try { await message.delete(); } catch(e){}

                // Buscar si ya tiene un canal creado para guiarle
                const suffix = member.id.slice(-4);
                const existingChannel = guild.channels.cache.find(c => 
                    c.type === ChannelType.GuildText && 
                    ((c.topic && c.topic.includes(member.id)) || (c.name.includes(suffix) && c.name.includes('registro')))
                );

                if (!existingChannel) {
                    // Si no tiene canal, se lo creamos automáticamente
                    console.log(`🚑 Usuario ${member.user.tag} intentó hablar sin canal. Creando...`);
                    await iniciarRegistro(member);
                } else {
                    // Si ya tiene, le avisamos con un mensaje temporal
                    const warning = await message.channel.send({ 
                        content: `${member}`, 
                        embeds: [new EmbedBuilder().setColor('Red').setDescription(`⛔ **Acceso Denegado:** Termina tu registro aquí: ${existingChannel}`)] 
                    });
                    setTimeout(() => warning.delete().catch(()=>{}), 5000);
                }
                
                // ⛔ DETENER EJECUCIÓN: No procesar nada más
                return;
            }
        }

        // ==================================================================
        // 📝 SISTEMA DE REGISTRO (LÓGICA DE PASOS)
        // ==================================================================
        
        // Recuperamos el estado desde la DB (SQLite)
        let state = null;
        try { state = getRegistrationState(message.channel.id); } catch (e) {}

        // Si NO es un canal de registro activo, terminamos aquí.
        if (!state) return; 

        // Seguridad: Solo el dueño del registro o admins pueden avanzar pasos en este canal
        if (message.author.id !== state.user_id && !isImmune) return;

        const content = message.content.trim();
        const lowerContent = content.toLowerCase();

        // 🛑 PASO 10: ESTADO DE ESPERA (CONGELADO)
        if (state.step === 10) {
            // El usuario está esperando aprobación. Ignoramos o borramos.
            try { await message.delete(); } catch(e){}
            return;
        }

        // ▶️ PASO 1: RECIBIR ID PLATAFORMA
        if (state.step === 1) {
            updateRegistrationState(message.channel.id, 2, content, undefined);
            await message.channel.send(`✅ ID Guardado: **${content}**\n\n🛡️ Ahora escribe el **nombre de tu Tribu**:\n*(Si la tribu ya existe, te preguntaré si quieres unirte)*.`);
            return;
        }

        // ▶️ PASO 2: RECIBIR NOMBRE DE TRIBU
        if (state.step === 2) {
            const tribes = loadTribes(message.guild.id);
            const inputTribe = content; // Mantenemos mayúsculas originales

            // Búsqueda insensible a mayúsculas para evitar duplicados visuales
            const existingTribeKey = Object.keys(tribes).find(k => k.toLowerCase() === inputTribe.toLowerCase());

            // A) LA TRIBU YA EXISTE
            if (existingTribeKey) {
                // Guardamos el nombre real de la tribu encontrada y pasamos al Paso 3
                try { updateRegistrationState(message.channel.id, 3, undefined, existingTribeKey); } catch(e) {}
                await message.channel.send(`ℹ️ La tribu **${existingTribeKey}** ya existe.\n¿Quieres solicitar unirte a ella? (Escribe **Si** o **No**)`);
                return;
            } 
            
            // B) LA TRIBU ES NUEVA -> Ir a Confirmación (Paso 4)
            else {
                try { updateRegistrationState(message.channel.id, 4, undefined, inputTribe); } catch(e) {}
                await sendConfirmationSummary(message.channel, state.data_id, inputTribe, "Crear Nueva Tribu");
                return;
            }
        }

        // ▶️ PASO 3: DECISIÓN ¿UNIRSE A EXISTENTE?
        if (state.step === 3) {
            const yesWords = ['si', 'yes', 's', 'y'];
            const noWords = ['no', 'n'];

            // USUARIO DICE SÍ (Quiere unirse)
            if (yesWords.includes(lowerContent)) {
                const tribes = loadTribes(message.guild.id);
                const targetTribe = tribes[state.data_tribe];
                const maxMembers = config.limits?.max_tribe_members || 0;

                // Validaciones extra
                if (!targetTribe) {
                    await message.channel.send(`❌ Error: La tribu **${state.data_tribe}** ha dejado de existir. Escribe otro nombre.`);
                    updateRegistrationState(message.channel.id, 2, undefined, null);
                    return;
                }

                if (maxMembers > 0 && targetTribe.members.length >= maxMembers) {
                    await message.channel.send(`❌ La tribu **${state.data_tribe}** está llena (${targetTribe.members.length}/${maxMembers}).\n🔄 Por favor, escribe otro nombre.`);
                    updateRegistrationState(message.channel.id, 2, undefined, null);
                    return;
                }

                // Enviar solicitud al canal de la tribu
                const tribeChannel = message.guild.channels.cache.get(targetTribe.channelId);
                
                if (!tribeChannel) {
                    await message.channel.send(`⚠️ La tribu **${state.data_tribe}** no tiene canal configurado. Contacta a un admin.`);
                    return;
                }

                const requestEmbed = new EmbedBuilder()
                    .setTitle('📨 Solicitud de Ingreso')
                    .setColor('Blue')
                    .setDescription(`El usuario **${member.user.tag}** (ID: ${state.data_id}) solicita unirse a vuestra tribu.`)
                    .addFields({ name: 'Acción Requerida', value: 'Cualquier miembro de la tribu puede aceptar o rechazar.' })
                    .setTimestamp();

                const rowTribe = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`join_accept_${member.id}_${message.channel.id}`).setLabel('✅ Aceptar').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`join_deny_${member.id}_${message.channel.id}`).setLabel('❌ Rechazar').setStyle(ButtonStyle.Danger)
                );

                await tribeChannel.send({ content: '@here', embeds: [requestEmbed], components: [rowTribe] });

                // Actualizar Estado -> 10 (ESPERANDO)
                updateRegistrationState(message.channel.id, 10, undefined, undefined);

                // Mensaje al Usuario
                const cancelRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('reg_cancel_join').setLabel('Cancelar Solicitud').setStyle(ButtonStyle.Secondary)
                );

                await message.channel.send({ 
                    content: `⏳ **Solicitud enviada a ${state.data_tribe}.**\nTu canal permanecerá abierto hasta que respondan.\nSi te has equivocado, pulsa cancelar.`,
                    components: [cancelRow] 
                });
                return;
            }

            // USUARIO DICE NO
            else if (noWords.includes(lowerContent)) {
                await message.channel.send(`🔄 Vale. Escribe **otro nombre de tribu**:`);
                updateRegistrationState(message.channel.id, 2, undefined, null);
                return;
            }

            else {
                await message.channel.send(`⚠️ Respuesta no válida. Escribe **Si** o **No**.`);
                return;
            }
        }

        // ▶️ PASO 4: CONFIRMACIÓN DE CREACIÓN
        if (state.step === 4) {
            const yesWords = ['si', 'yes', 's', 'y', 'correcto', 'confirmar'];
            const noWords = ['no', 'n', 'mal', 'error', 'corregir'];

            if (yesWords.includes(lowerContent)) {
                // CREAR TRIBU Y FINALIZAR (Nueva tribu = true)
                await finalizarRegistro(member, message.channel, state.data_id, state.data_tribe, config, true);
            } 
            else if (noWords.includes(lowerContent)) {
                await message.channel.send(`❓ ¿Qué dato es incorrecto? Escribe **id** o **tribu**:`);
                updateRegistrationState(message.channel.id, 5, undefined, undefined);
            }
            else {
                // Atajos directos
                if (lowerContent.includes('id')) {
                    await message.channel.send(`✏️ Escribe tu nuevo **ID de Plataforma**:`);
                    updateRegistrationState(message.channel.id, 1, null, undefined);
                } else if (lowerContent.includes('tribu')) {
                    await message.channel.send(`✏️ Escribe el nuevo **nombre de Tribu**:`);
                    updateRegistrationState(message.channel.id, 2, undefined, null);
                } else {
                    await message.channel.send(`⚠️ Escribe **Si** para confirmar o **No** para corregir.`);
                }
            }
            return;
        }

        // ▶️ PASO 5: SELECCIÓN DE CORRECCIÓN
        if (state.step === 5) {
            if (lowerContent.includes('id') || lowerContent.includes('plataforma')) {
                await message.channel.send(`✏️ Escribe tu nuevo **ID de Plataforma**:`);
                updateRegistrationState(message.channel.id, 1, null, undefined);
            } else if (lowerContent.includes('tribu') || lowerContent.includes('nombre')) {
                await message.channel.send(`✏️ Escribe el nuevo **nombre de Tribu**:`);
                updateRegistrationState(message.channel.id, 2, undefined, null);
            } else {
                await message.channel.send(`⚠️ Opción no reconocida. Escribe "id" o "tribu".`);
            }
            return;
        }
    },
    
    // Exportamos la función para que se pueda usar desde interactionCreate.js
    finalizarRegistro
};

// ==========================================
// FUNCIONES AUXILIARES
// ==========================================

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

async function finalizarRegistro(member, channel, idPlay, tName, config, isNewTribe) {
    // 1. Limpiar estado de DB
    try { deleteRegistrationState(channel.id); } catch(e) {}
    
    await channel.send(`✅ **¡Registro Completado!** Procesando...`);

    const guild = member.guild;
    let tribes = loadTribes(guild.id);
    let tData = tribes[tName];
    let tRole = guild.roles.cache.find(r => r.name === tName);

    // 2. Si es nueva tribu, crear Rol y Canal
    if (isNewTribe || !tData) {
        if (!tRole) tRole = await guild.roles.create({ name: tName, color: 'Random', reason: 'Registro BotArk' });
        
        let tCatId = config.categories.tribes;
        
        const tChan = await guild.channels.create({ 
            name: tName, 
            type: ChannelType.GuildText, 
            parent: tCatId, 
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }, 
                { id: tRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }, 
                { id: member.client.user.id, allow: [PermissionFlagsBits.ViewChannel] }
            ] 
        });
        
        tData = { 
            members: [], 
            warnings: 0, 
            channelId: tChan.id, 
            instructionMessageId: null, 
            lastActive: Date.now(), 
            alliances: [], 
            allianceChannels: [] 
        };
        tribes[tName] = tData; 
        
        await channel.send(`✅ Tribu **${tName}** creada correctamente.`);
    }

    // 3. Gestión de Roles
    const rank = (tData.members.length === 0) ? 'Líder' : 'Miembro';
    
    // Dar Rol Tribu
    if (tRole) await member.roles.add(tRole).catch(()=>{});
    
    // Dar Rol Superviviente
    const survivorRole = guild.roles.cache.get(config.roles.survivor);
    if (survivorRole) await member.roles.add(survivorRole).catch(()=>{});
    
    // Quitar Rol No Verificado
    const unverifiedRole = guild.roles.cache.get(config.roles.unverified);
    if (unverifiedRole) await member.roles.remove(unverifiedRole).catch(()=>{});
    
    // Si es Líder, dar rol Líder
    if (rank === 'Líder') { 
        const lRole = guild.roles.cache.get(config.roles.leader); 
        if (lRole) await member.roles.add(lRole).catch(()=>{}); 
    }

    // 4. Guardar Datos
    tData.members.push({ 
        username: member.user.username, 
        idPlay: idPlay, 
        discordId: member.id, 
        hasKit: false, 
        warnings: 0, 
        rango: rank 
    });
    
    saveTribes(guild.id, tribes); 
    
    // 5. Actualizar Logs y Paneles
    await updateLog(guild, member.client);
    await updateTribePanel(guild, tName);

    // 6. Mensaje de Bienvenida Global
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
        } catch (e) {
            console.error("Error enviando bienvenida:", e);
        }
    }

    // 7. Borrar canal de registro
    await channel.send(`👋 **Todo listo.** Cerrando canal...`);
    setTimeout(async () => { try { if (channel) await channel.delete(); } catch (e) {} }, 5000);
}