let publication;
let conference;
let token;
let config;
let userInfo;
const subscriptions = [];
const participants = {};
const streams = {};
let orderSeed = 0;

function updateParticipant(participant, left) {
    let userElement = document.getElementById('user-' + participant.id);
    if (!userElement) {
        userElement = document.createElement('li');
        userElement.id = 'user-' + participant.id;
    }
    userElement.innerHTML = '<strong style="color: ' + (participant.id === userInfo.id ? 'green' : left ? 'red' : 'black') + '">' + participant.userId + '</strong> <code style="color: gray">(' + participant.id + ')</code>' + (left ? '<span style="color:red"> Left!</span>' : '');
    document.getElementById('users').appendChild(userElement);
}

function updateParticipants(newParticipants) {
    document.getElementById('usersContainer').style.display = 'block';
    for (const participant of newParticipants) {
        updateParticipant(participant);
        if (!participants[participant.id]) {
            participants.order = orderSeed++;
            participants[participant.id] = participant;
            participant.addEventListener('left', event => {
                updateParticipant(participant, true);
                delete participants[participant.id];
            });
        }
    }
}

function getSearchParam(key = null, search = null) {
    const params = {};
    search = search === null ? window.location.search : search;
    if (search.length > 1) {
        if (search[0] === '?') {
            search = search.substr(1);
        }
        const searchArr = search.split('&');
        for (const pair of searchArr) {
            const pairValues = pair.split('=', 2);
            if (pairValues.length > 1) {
                try {
                    params[pairValues[0]] = decodeURIComponent(pairValues[1]);
                } catch (_) {
                    if (DEBUG) {
                        console.error(_, {key, search});
                    }
                    params[pairValues[0]] = '';
                }
            } else {
                params[pairValues[0]] = '';
            }
        }
    }
    return key ? params[key] : params;
};

function updateAudioElement(stream) {
    let audioElement = document.getElementById('audio-' + stream.id);
    if (!audioElement) {
        const audioContainer = document.createElement('div');
        audioContainer.style = 'border: 1px solid #ddd; float: left; margin: 5px; padding: 5px;';
        const participant = participants[stream.origin];
        audioContainer.id = 'audioContainer-' + stream.id;
        const isMixed = stream.id.includes('common');
        audioContainer.innerHTML = '<div style="margin-bottom: 4px">' + (participant ? ('<strong>' + participant.userId + '</strong>') : '') + (isMixed ? '<strong style="color: blue">Mixed stream</strong>' : ('<code style="color: gray">(' + stream.id + ')')) + '</code></div>';

        audioElement = document.createElement('audio');
        if (!participant) {
            audioElement.autoplay = 'autoplay';
        }
        audioElement.id = 'audio-' + stream.id;
        audioElement.controls = 'controls';
        audioContainer.appendChild(audioElement);
        if (isMixed) {
            const localAudioConfainer = document.getElementById('localAudioConfainer');
            localAudioConfainer.parentNode.insertBefore(audioContainer, localAudioConfainer.nextSibling);
        } else {
            document.getElementById('audios').appendChild(audioContainer);
        }
    }
    audioElement.setAttribute('data-id', stream.id);
    audioElement.srcObject = stream.mediaStream;
}

function subscribeStream(stream) {
    streams[stream.id] = stream;

    // if (!stream.mediaStream) {
    //     return console.info('SUBSCRIBE', stream.id, 'failed with empty mediaStream.', stream);
    // }
    // if (!stream.origin) {
    //     return console.info('SUBSCRIBE', stream.id, 'failed with no origin.', stream);
    // }
    if (!stream.source.audio) {
        return console.info('SUBSCRIBE', stream.id, 'failed with no audio.', stream);
    }
    if (stream.origin === userInfo.id) {
        return console.info('SUBSCRIBE', stream.id, 'failed with self origin.', stream);
    }

    console.log('SUBSCRIBE', stream.id);
    conference.subscribe(stream, {
        audio: true,
        video: false
    }).then(subscription => {
        subscriptions.push(subscription);
        updateAudioElement(stream);
        console.log('✅ SUBSCRIBE success', stream.id, {stream, subscription});
    }, (error) => {console.error('❗️SUBSCRIBE failed', stream.id, {stream, error});});

    stream.addEventListener('ended', (event) => {
        console.log('EVENT: stream.ended', event);
        const audioElement =  document.getElementById('audioContainer-' + stream.id);
        if (audioElement) {
            audioElement.remove();
        }
    });
    stream.addEventListener('updated', (event) => {
        console.log('EVENT: stream.updated', event);
        updateAudioElement(stream);
    });
}

function joinConference(callback) {
    conference.join(token).then(resp => {
        console.log('Conference.join', resp);
        userInfo = resp.self;
        document.getElementById('userInfo').innerHTML = 'You have joined: <strong>' + userInfo.userId + '</strong> <code style="color: gray">(' + userInfo.id + ')</code>';

        // 推送音频流
        if (config.publish !== false) {
            const audioConstraints = new Owt.Base.AudioTrackConstraints(Owt.Base.AudioSourceInfo.MIC);
            Owt.Base.MediaStreamFactory.createMediaStream(new Owt.Base.StreamConstraints(audioConstraints)).then(stream => {
                const publishOption = {
                    // audio: [
                    //     {channelCount: 1, name: 'myAudio'}
                    // ]
                };
                const mediaStream = stream;
                const localStream = new Owt.Base.LocalStream(mediaStream, new Owt.Base.StreamSourceInfo('mic'));
                document.getElementById('localAudio').srcObject = stream;
                document.getElementById('localAudioConfainer').style.display = 'block';
                console.log('createMediaStream', {mediaStream, localStream});

                conference.publish(localStream, publishOption).then(newPublication => {
                    console.log('conference.publish', newPublication);
                    publication = newPublication;
                    mixStream(config.room, publication.id, 'common', config.api);
                    publication.addEventListener('error', (error) => {
                        console.error('EVENT publication.error', error);
                    });
                    publication.addEventListener('ended', (event) => {
                        console.log('EVENT publication.ended', event);
                    });
                });
            }, err => {
                console.error('Failed to create MediaStream, ' + err);
            });
        }

        // 订阅音频流
        var streams = resp.remoteStreams;
        for (const stream of streams) {
            subscribeStream(stream);
        }
        conference.addEventListener('streamadded', function(event) {
            console.log('EVENT: conference.streamadded', event);
            subscribeStream(event.stream);
        });

        // 显示参与者
        var participants = resp.participants;
        updateParticipants(participants);
        console.log('Participants in conference: ' + participants.length);

        // 监听用户加入事件
        conference.addEventListener('participantjoined', event => {
            console.log('EVENT: conference.participantjoined', event);
            updateParticipants([event.participant]);
        });
    });
}

function startConference(userConfig) {
    const storageConfig = localStorage.getItem('owt.config.api');
    config = Object.assign({
        room: '5e44ee0cb0b6521044bbf581',
        user: 'user',
        role: 'presenter',
        port: 3004
    }, storageConfig ? JSON.parse(storageConfig) : null, userConfig, getSearchParam());

    if (!config.api) {
        if (config.host) {
            config.api = `https://${config.host}:${config.port}`;
        } else {
            config.api = prompt('请输入 API 地址，例如：192.168.0.1:3004');
        }
    }
    if (!config.api.startsWith('https://')) {
        config.api = `https://${config.api}`;
    } else if (config.api.startsWith('http://')) {
        alert('API 地址必须使用 https 协议。');
        config.api = config.api.replate('http:', 'https:');
    }

    const configsElement = document.getElementById('configs');
    Object.keys(config).forEach(configName => {
        const configItem = document.createElement('li');
        configItem.innerHTML = `<strong>${configName}</strong>: <code>${config[configName]}</code>`;
        configsElement.appendChild(configItem);
    });

    conference = new Owt.Conference.ConferenceClient();

    createToken(config.room, config.user.replace('$', (Date.now()%10000).toString(16)), config.role, function(serverToken) {
        token = serverToken;
        localStorage.setItem('owt.config.api', JSON.stringify(config));
        joinConference();
    }, config.api);
}
