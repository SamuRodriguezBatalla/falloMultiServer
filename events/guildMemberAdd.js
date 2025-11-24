const { Events, PermissionsBitField, EmbedBuilder, ChannelType } = require('discord.js');
const { loadGuildConfig, saveGuildConfig, isPermabanned } = require('../utils/dataManager');
const { createCompositeImage } = require('../utils/imageMaker');

const processingMembers = new Set();

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        await this.iniciarRegistro(member);
    },

    iniciarRegistro: async function(member) {
        if (member.user.bot) return;

        if (processingMembers.has(member.id)) return;
        processingMembers.add(member.id);
        setTimeout(() => processingMembers.delete(member.id), 10000);

        try {
            const guild = member.guild;
            let config = loadGuildConfig(guild.id);
            if (!config) return; 

            // 1. PORTERO PERMABAN
            const permabanData = isPermabanned(member.guild.id, member.id);
            if (permabanData) {
                const suffix = member.id.slice(-4);
                let existingChannel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.topic && c.topic.includes(`USER:${member.id}`));
                if (!existingChannel && config.categories.private_registration) {
                    existingChannel = guild.channels.cache.find(c => c.parentId === config.categories.private_registration && c.name.includes(suffix));
                }
                if (existingChannel) await existingChannel.delete('Limpieza por Permaban').catch(()=>{});

                const banChannel = config.channels.ban_notifications ? await guild.channels.fetch(config.channels.ban_notifications).catch(()=>null) : null;
                if (banChannel) {
                    const banAttachment = await createCompositeImage(guild, member.user, 'ban');
                    const filesArray = banAttachment ? [banAttachment] : [];
                    const imgUrl = banAttachment ? 'attachment://ban-image.png' : null;

                    const banEmbed = new EmbedBuilder()
                        .setColor('#8B0000')
                        .setTitle('🛡️ ACCESO BLOQUEADO (Permaban)')
                        .setDescription(`**${member.user.tag}** intentó entrar.\nRazón: \`${permabanData.reason}\``)
                        .setTimestamp();
                    
                    if(imgUrl) banEmbed.setImage(imgUrl);
                    await banChannel.send({ embeds: [banEmbed], files: filesArray });
                }
                
                try {
                    await member.send(`⛔ **Acceso Denegado.**\nEstás en la Lista Negra.\n**Razón:** ${permabanData.reason}`).catch(()=>{});
                    await member.ban({ reason: `[AUTO-BLACKLIST] ${permabanData.reason}` });
                } catch (e) {}
                return; 
            }

            if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return; 

            // 2. Asignar Rol
            const unverifiedRole = guild.roles.cache.get(config.roles.unverified);
            if (unverifiedRole && !member.roles.cache.has(unverifiedRole.id)) {
                await member.roles.add(unverifiedRole).catch(()=>{});
            }

            // 3. Evitar duplicados
            await guild.channels.fetch(); 
            const suffix = member.id.slice(-4);
            let oldCh = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.topic && c.topic.includes(`USER:${member.id}`));
            
            if (!oldCh && config.categories.private_registration) {
                const cat = guild.channels.cache.get(config.categories.private_registration);
                if (cat) oldCh = cat.children.cache.find(c => c.name.includes(suffix) && c.name.includes('registro'));
            }

            if (oldCh) return; 

            // 4. Crear Canal
            let catId = config.categories.private_registration;
            let catObj = guild.channels.cache.get(catId);
            
            if (!catObj) {
                catObj = guild.channels.cache.find(c => c.name === '🔐 Rᴇgistrᴏ-Pʀiᴠᴀdᴏ' && c.type === ChannelType.GuildCategory);
                if (!catObj) {
                    const newCat = await guild.channels.create({ name: '🔐 Rᴇgistrᴏ-Pʀiᴠᴀdᴏ', type: ChannelType.GuildCategory, position: 0, permissionOverwrites: [{ id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }] });
                    config.categories.private_registration = newCat.id; saveGuildConfig(guild.id, config); catId = newCat.id;
                } else { config.categories.private_registration = catObj.id; saveGuildConfig(guild.id, config); catId = catObj.id; }
            }

            const cleanName = member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
            
            // ⚠️ FIX CRÍTICO: AHORA USA EL TOPIC CORRECTO PARA QUE messageCreate LO LEA
            const initialTopic = `REGISTRO_ACTIVO | USER:${member.id} | STEP:1 | DATA_ID:null | DATA_TRIBE:null`;

            const channel = await guild.channels.create({
                name: `registro-${cleanName}-${suffix}`, 
                type: ChannelType.GuildText, 
                parent: catId, 
                topic: initialTopic, // <--- ESTO ES LO IMPORTANTE
                permissionOverwrites: [{ id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, { id: member.client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }]
            });

            const season = config.season || 0;
            
            const welcomeEmbed = new EmbedBuilder()
                .setColor('#00BFFF')
                .setTitle(`👋 ¡Bienvenido a ${guild.name}!`)
                .setDescription(`Hola ${member}, soy **${member.client.user.username}**, el asistente de **${guild.name}**.\nEstás a un paso de entrar a la **Season ${season}**.`)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '📋 Instrucciones', value: 'Por favor, responde a las siguientes preguntas para completar tu ficha de superviviente.' },
                    { name: '🚀 Paso 1/2', value: '**Escribe tu ID de Plataforma** a continuación.' }
                )
                .setFooter({ text: 'Registro Automático • Tus datos son privados aquí.' })
                .setTimestamp();

            await channel.send({ content: `${member}`, embeds: [welcomeEmbed] });

        } catch (error) {
            console.error(`Error iniciarRegistro ${member.user.tag}:`, error);
        }
    }
};
