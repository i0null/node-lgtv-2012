#!/usr/bin/env node

var xpath = require('xpath');
var dom = require('xmldom').DOMParser;
var http = require('http');

function lgtv(config) {
    var host = config.host || '127.0.0.1';
    var port = config.port || 8080;

    this.agent = null;
    this.debug = true;

    this.min_volume = 2
    this.false_run = false
    this.locked = false

    var commands = {
        // Numbers
        '0': 2, '1': 3, '2': 4, '3': 5, '4': 6,
        '5': 7, '6': 8, '7': 9, '8': 10, '9': 11,
        // Arrows
        'UP': 12, 'DOWN': 13, 'LEFT': 14, 'RIGHT': 15,
        // Actions
        'POWER': 1, 'ENTER': 20, 'BACK': 23, 'EXIT': 412,
        // Volume 
        'VOL_UP': 24, 'VOL_DOWN': 25, 'MUTE': 26,
        // Adjust Channel
        'CH_UP': 27, 'CH_DOWN': 28, 'LAST': 403,
        // Colours
        'BLUE': 29, 'GREEN': 30, 'RED': 31, 'YELLOW': 32,
        // Play State
        'PLAY': 33, 'PAUSE': 34, 'STOP': 35,
        // Position
        'FF': 36, 'REWIND': 37, 'SKIP_FORWARD': 39, 'SKIP_BACKWARD': 39,
        // Record
        'RECORD': 40, 'RECORDING': 41, 'LIVE': 43,
        'ASPECT_RATIO': 46, 'INPUT': 47,
        // Lists Channels
        'EPG': 44, 'CHANNELS': 50, 'FAV': 404,
        // Menu
        'QMENU': 405, 'TELETEXT': 51,
        // Turn On Subs
        'SUBS': 49, 'AUDIO_DESC': 407,
        // 3D
        '3D': 400, 'GAME_3D': 401,
        // Identify
        'APPS': 417, 'INFO': 45, 'HOME': 21,
        // Not Implemented
        'REPEAT': 42,
        'PIP': 48, 'PIP_CH_UP': 414, 'PIP_CH_DOWN': 415,
        'MARK': 52, 'DASH': 402,
        'TEXT_OPTION': 406,
        'ENERGY_SAVING': 409,
        'AV_MODE': 410,
        'SIMPLINK': 411,
        'RESERVATION_PROGRAM_LIST': 413,
        'SWITCH_VIDEO': 416
    };
    
    function log(msg) { 
        if(this.debug) console.log(msg);
    }

    // --- [ HTTP Agent ] ---
    var http_agent = null;

    function getAgent(cb) {
        if (http_agent === null) http_agent = new http.Agent({
            maxSockets: 1, keepAlive: true, keepAliveMsecs: 500 
        })
        if(cb) cb(http_agent)
    }

    // --- [ HTTP Request Methods ] ---
    function get(path, cb) {
        getAgent((agent) => { http.get({ host: host, port: port, path: path, agent: agent}, (response) => {
            var body = ''; response.on('data', (d) => { body += d; });
            response.on('end', (err) => { if(cb) cb(body); });
        }).on('error', function(error) {
            log(`Error on GET ${path} ${error.message}`)
            if (cb) cb('');
        }) });
    }

    function post(path, data, cb) { 
        var headers = {
            'Accept-Encoding': 'identity',
            'Content-Length': Buffer.byteLength(data),
            'Content-Type': 'application/atom+xml'
        };
        getAgent((agent) => {
            var request = http.request({
                agent: agent, host: host, port: port,
                method: 'POST', path: path, headers: headers, 
            }, (response) => { response.setEncoding('utf8');
                var body = ''; response.on('data', (d) => { body += d; });
                response.on('end', (err) => { 
                    if(cb) cb(body); 
                });
            }).on('error', function(error) {
                log(`Error: Unable to get ${path} ${error.message}`);
                if(cb) cb('');
            });
            request.write(data);
            request.end();
        });
    };

    // --- [ Send commands ] ---

    // Send Single Command
    function send_command(command, cb) {
        var cmd = commands[command.toUpperCase()];
        if(parseInt(cmd)) {
            post('/roap/api/command', `<?xml version='1.0' encoding='utf-8'?><command><name>HandleKeyInput</name><value>${cmd}</value></command>`, (body) => {
                try {
                    var doc = new dom().parseFromString(body);
                    if(cb) cb(xpath.select('//ROAPErrorDetail/text()', doc).toString() == 'OK')
                } catch(error) {
                    log(`error send_command:  ${error.message}`)
                    if(cb) cb(false)
                }
            });
        }
    }
    this.send_command = send_command

    // Send Multiple Commands
    function send_commands(cmds, cb) {
        function callback(value) {
            if (cb) cb(value)
            this.locked = false
        }
        function run() { 
            if (this.locked = cmds.length > 0) send_command(cmds.shift(), (success) => {
                if (success) setTimeout(run, 200);
                else callback(false);
            });
            else callback(true); 
        };
        if(!this.locked) run();
    }

    // Return Volume/Mute Status
    this.get_volume = function(cb) {
        get('/roap/api/data?target=volume_info', (body) => {
            var doc = new dom().parseFromString(body);
            try {
                if(cb) cb({ 
                    level: parseInt(xpath.select('//level/text()', doc).toString()),
                    mute: xpath.select('//mute/text()', doc).toString() == 'true'
                })
            } catch(error) {
                log('error get_volume: ' + error.message)
                if(cb) cb({ level: 0, mute: false })
            }
        })
    }
    
    this.set_volume = function (to, cb) {
        this.get_volume((volume) => {
            if( diff = parseInt(to) - volume.level) {
                var action = 'UP';
                var cmds = [];
                if(to >= this.min_volume == volume.mute) cmds.push('MUTE')
                if(diff < 0)  { action = 'DOWN'; diff *= -1; } 
                while(diff-- > 0) cmds.push('VOL_' + action)
                if(cmds.length) send_commands(cmds, (err) => { if(cb) cb(err); })
            }  else {
                log('Already at volume ' + to)
                if(cb) cb(false);
            }
        })
    };

    this.pair_request = function(cb) {
        post('/roap/api/auth', "<?xml version='1.0' encoding='utf-8'?><auth><type>AuthKeyReq</type></auth>", (body) => {
            //var session = xpath.select('//session/text()', new dom().parseFromString(body)).toString()
            if(cb) cb(body);
        })
    };

    this.new_session = function(key, cb) {
        var req = `<?xml version='1.0' encoding='utf-8'?><auth><type>AuthReq</type><value>${key}</value></auth>`;
        post('/roap/api/auth', req, (body) => {
            //var session = xpath.select('//session/text()', new dom().parseFromString(body)).toString()
            if(cb) cb(this);
        })
    };

    this.get_channel = function(cb) {
        // Get Channel
        get('/roap/api/data?target=cur_channel', (body) => {
            try {
                var body = new dom().parseFromString(body);
                if(cb) cb({
                    number: parseInt(xpath.select('//major/text()', body).toString()),
                    title: xpath.select('//chname/text()', body).toString(),
                    program: xpath.select('//progName/text()', body).toString()
                })
            } catch(error) {
                if(cb) cb({ channel: 0, name: 'Unknown', program: 'Unknown' });
            }
        })
    }

    // Get Channel
    this.get_channels = function(cb) {
        get('/roap/api/data?target=channel_list', (body) => {
            var channels = {};
            try {
                var xpath = new dom().parseFromString(body);
                xpath.select('//data').forEach(function(ch) {
                    var number = ch.select('minor/text()').toString();
                    channels[number] = {
                        'name': ch.select('chname/text()').toString(),
                        'isRadio': bool(number != ch.select('major/text()').toString())
                    }
                });
            } catch(error) {
                log(`error get_channels: ${error}`);
            } finally {
                if(cb) cb(channels);
            }
        });
    };

    this.turn_off = function(cb) {
        send_command('POWER', (err) => { if (cb) cb(err); });
        getAgent((agent) => { agent.destroy(); });
    };

    this.set_channel = function(to_channel, cb) {
        var cmds = to_channel.toString().split('');
        if (cmds.length && parseInt(to_channel)) {
            log('Setting TV [' + host + '] to channel: ' + to_channel); 
            cmds.push('ENTER');
            if(this.false_run) { if(cb) cb(false) }
            else { send_commands(cmds, (err) => { if(cb) cb(true) }) }
        } else {
            log('Not a valid channel'); 
            if(cb) cb(false)
        }
    }
}

module.exports = { lgtv: lgtv }
