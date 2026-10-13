// Classe du clap audio de Cinema Script, copiée telle quelle depuis
// BigbangX6/cinema_script@3e8ec90 (index.html). Référence pour vérifier que la
// version .oneapp produit exactement le même son. NE PAS MODIFIER.
class DigitalClapper {
    constructor() {
        this.audioCtx = null;
        this.dtmfFreqs = {
            //'1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
            //'4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
            //'7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
            //'*': [941, 1209], '0': [941, 1336], '#': [941, 1477]

            '1': [10697, 12209], '2': [10697, 12336], '3': [10697, 12477],
            '4': [10770, 12209], '5': [10770, 12336], '6': [10770, 12477],
            '7': [10852, 12209], '8': [10852, 12336], '9': [10852, 12477],
            '*': [10941, 12209], '0': [10941, 12336], '#': [10941, 12477]
        };
    }
    play(scene, shot, take) {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
        const payload = `*${scene}*${shot}*${take}#*`;
        const now = this.audioCtx.currentTime;
        
        //this._playTransient(now);
        
        let timeCursor = now + 0.065;
        const toneDuration = 0.080;
        const pauseDuration = 0.120;
        for (let i = 0; i < payload.length; i++) {
            const char = payload[i];
            if (this.dtmfFreqs[char]) {
                this._playDTMF(this.dtmfFreqs[char][0], this.dtmfFreqs[char][1], timeCursor, toneDuration);
                timeCursor += toneDuration + pauseDuration;
            }
        }
        
    }
    _playTransient(startTime) {
        const clickOsc = this.audioCtx.createOscillator();
        const clickGain = this.audioCtx.createGain();
        clickOsc.type = 'square';
        clickOsc.frequency.value = 1000;
        clickGain.gain.setValueAtTime(0, startTime);
        clickGain.gain.linearRampToValueAtTime(1, startTime + 0.001);
        clickGain.gain.setValueAtTime(1, startTime + 0.010);
        clickGain.gain.linearRampToValueAtTime(0, startTime + 0.015);
        clickOsc.connect(clickGain);
        clickGain.connect(this.audioCtx.destination);
        clickOsc.start(startTime);
        clickOsc.stop(startTime + 0.020);
    }
    _playDTMF(f1, f2, startTime, duration) {
        const osc1 = this.audioCtx.createOscillator();
        const osc2 = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();
        osc1.frequency.value = f1;
        osc2.frequency.value = f2;
        osc1.type = 'sine';
        osc2.type = 'sine';
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(0.75, startTime + 0.005);
        gainNode.gain.setValueAtTime(0.75, startTime + duration - 0.005);
        gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
        osc1.connect(gainNode);
        osc2.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);
        osc1.start(startTime);
        osc2.start(startTime);
        osc1.stop(startTime + duration);
        osc2.stop(startTime + duration);
    }
}
