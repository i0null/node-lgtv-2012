# LG TV 2012 Series Remote

NodeJS module to control LG 2012 Series TV's.

Built specifically to support the homebridge-lgtv-2012 plugin.

## Features
* Power on/off
* Mute on/off
* Change volume
* Get/Set Channel 

## Install
```npm install -g lgtv-2012```

## Get TV Pairing key
```bash 
node -e "ip = '172.16.0.10'; lg = require('lgtv-2012').lgtv; tv = new lg({host: ip}); tv.pair_request()"
```

## Usage Examples

- Get/Set Volume:
```js
    this.connect((tv) => {
        tv.get_volume( (volume) => {
            console.log('Channel: ' + volume.level + ' and Mute is ' + volume.mute? 'On':'Off')

            if(volume.mute || volume.level != 10) {
                tv.set_volume(10, null)
            }
        })
    })
```

- Get/Set Channel
```js
    this.connect((tv) => {
        tv.get_channel( (channel) => {
            console.log(`Channel: #${channel.number} ${channel.title}`);
            console.log(`Program: ${channel.program}`);
        })
        tv.set_channel(107, null)
    })
```

- Turn Off
```js
    this.connect((tv) => {
        tv.turn_off(null)
    })
```
