document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const audioSelect = document.getElementById('audioSource');
    const startButton = document.getElementById('startButton');
    const message = document.getElementById('message');
    const frequencyDisplay = document.getElementById('frequency');
    const noteDisplay = document.getElementById('note');
    const centsDisplay = document.getElementById('cents');
    const tunerBar = document.getElementById('tunerBar');
    const testModeCheckbox = document.getElementById('testModeCheckbox');
    const testFrequencyInput = document.getElementById('testFrequency');
    const volumeSlider = document.getElementById('volumeSlider');
    const tuningSelect = document.getElementById('tuningSelect');
    const customTuningInputs = document.getElementById('customTuningInputs');
    const stringButtons = document.querySelectorAll('.string-button');
  
    // Preset tunings: arrays of frequencies for strings 6 (lowest) to 1 (highest)
    const tunings = {
      "Standard": [82.41, 110.00, 146.83, 196.00, 246.94, 329.63],
      "Drop D":   [73.42, 110.00, 146.83, 196.00, 246.94, 329.63],
      "Open G":   [73.42, 98.00, 146.83, 196.00, 246.94, 293.66],
      "DADGAD":   [73.42, 110.00, 146.83, 196.00, 220.00, 293.66],
      "Drop C":   [65.41, 98.00, 130.81, 174.61, 220.00, 293.66],
      "Custom":   null
    };
  
    // Request permission so device labels can be displayed.
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        stream.getTracks().forEach(track => track.stop());
        return navigator.mediaDevices.enumerateDevices();
      })
      .then(devices => {
        devices.forEach(device => {
          if (device.kind === 'audioinput') {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Microphone ${audioSelect.length + 1}`;
            audioSelect.appendChild(option);
          }
        });
      })
      .catch(error => {
        console.error('Error accessing media devices:', error);
        message.textContent = 'Error accessing media devices: ' + error.message;
      });
    
    let audioContext;
    let analyser;
    let microphone;
    let testOscillator; // For test mode.
    let globalGainNode; // For controlling output volume.
    let rafID;
    
    // For smoothing cents offset
    let smoothedCents = 0;
    const smoothingFactor = 0.15;
    
    // When Start Tuner is clicked, decide between test mode or microphone input.
    startButton.addEventListener('click', () => {
      // Stop any existing test oscillator.
      if (testOscillator) {
        testOscillator.stop();
        testOscillator.disconnect();
        testOscillator = null;
      }
      // Create audioContext if needed.
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      // (Re)create a global gain node for test mode and open string playback.
      globalGainNode = audioContext.createGain();
      globalGainNode.gain.value = parseFloat(volumeSlider.value);
      
      // In Test Mode, generate a test tone.
      if (testModeCheckbox.checked) {
        const testFreq = parseFloat(testFrequencyInput.value) || 440;
        testOscillator = audioContext.createOscillator();
        testOscillator.frequency.setValueAtTime(testFreq, audioContext.currentTime);
        testOscillator.type = 'sine';
        
        // Route oscillator to gain node, then to analyser and destination.
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        testOscillator.connect(globalGainNode);
        globalGainNode.connect(analyser);
        globalGainNode.connect(audioContext.destination);
        
        testOscillator.start();
        message.textContent = `Test tone started at ${testFreq} Hz.`;
        updatePitch();
      } else {
        // Use the selected microphone.
        const deviceId = audioSelect.value;
        const constraints = { audio: { deviceId: deviceId ? { exact: deviceId } : undefined } };
        navigator.mediaDevices.getUserMedia(constraints)
          .then(stream => {
            message.textContent = 'Audio stream started.';
            microphone = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            // In microphone mode, we do not route sound to destination.
            microphone.connect(analyser);
            updatePitch();
          })
          .catch(error => {
            console.error('Error starting audio stream:', error);
            message.textContent = 'Error starting audio stream: ' + error.message;
          });
      }
    });
    
    // Volume slider changes the gain value (for test mode and open string tones)
    volumeSlider.addEventListener('input', () => {
      if (globalGainNode) {
        globalGainNode.gain.value = parseFloat(volumeSlider.value);
      }
    });
    
    // Update open string buttons based on the selected tuning.
    function updateOpenStrings() {
      let tuningArray;
      const selectedTuning = tuningSelect.value;
      if (selectedTuning === "Custom") {
        // Read custom tuning inputs.
        tuningArray = [
          parseFloat(document.getElementById('customString6').value),
          parseFloat(document.getElementById('customString5').value),
          parseFloat(document.getElementById('customString4').value),
          parseFloat(document.getElementById('customString3').value),
          parseFloat(document.getElementById('customString2').value),
          parseFloat(document.getElementById('customString1').value)
        ];
      } else {
        tuningArray = tunings[selectedTuning];
      }
      // Update each string button's data and label.
      stringButtons.forEach((button, index) => {
        // index 0 corresponds to string 6 (lowest), index 5 to string 1.
        const freq = tuningArray[index];
        // Use the frequencyToNote function (defined later) to compute note name.
        const noteData = frequencyToNote(freq);
        button.setAttribute('data-frequency', freq);
        button.textContent = `${noteData.note}${noteData.octave} (${freq.toFixed(2)} Hz)`;
      });
    }
    
    // Listen for changes on the tuning select.
    tuningSelect.addEventListener('change', () => {
      // Show custom inputs if "Custom" is selected.
      if (tuningSelect.value === "Custom") {
        customTuningInputs.style.display = "flex";
      } else {
        customTuningInputs.style.display = "none";
      }
      updateOpenStrings();
    });
    
    // Also update open strings when any custom tuning input changes.
    customTuningInputs.querySelectorAll('input[type="number"]').forEach(input => {
      input.addEventListener('input', updateOpenStrings);
    });
    
    // Initialize open strings with default (Standard) tuning.
    updateOpenStrings();
    
    // When an open string button is clicked, play its tone for 1 second.
    stringButtons.forEach(button => {
      button.addEventListener('click', () => {
        const freq = parseFloat(button.getAttribute('data-frequency'));
        playTone(freq, 1);
      });
    });
    
    // Function to play a tone of given frequency and duration (in seconds).
    function playTone(freq, duration) {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      const osc = audioContext.createOscillator();
      osc.frequency.setValueAtTime(freq, audioContext.currentTime);
      osc.type = 'sine';
      
      // Create a temporary gain node and set its gain based on the volume slider.
      const tempGain = audioContext.createGain();
      tempGain.gain.value = parseFloat(volumeSlider.value);
      osc.connect(tempGain);
      tempGain.connect(audioContext.destination);
      
      osc.start();
      osc.stop(audioContext.currentTime + duration);
    }
    
    // Continuously analyze the audio input (or test tone) and update the display.
    function updatePitch() {
      const bufferLength = analyser.fftSize;
      const buffer = new Float32Array(bufferLength);
      analyser.getFloatTimeDomainData(buffer);
    
      const pitch = autoCorrelate(buffer, audioContext.sampleRate);
      if (pitch !== -1) {
        frequencyDisplay.textContent = pitch.toFixed(2);
        const noteData = frequencyToNote(pitch);
        noteDisplay.textContent = noteData.note + noteData.octave;
        centsDisplay.textContent = noteData.cents.toFixed(2);
    
        // Smooth the cents value.
        smoothedCents += (noteData.cents - smoothedCents) * smoothingFactor;
        const maxCents = 50;
        let cents = Math.max(-maxCents, Math.min(maxCents, smoothedCents));
        const maxPixelOffset = 100;
        const offset = (cents / maxCents) * maxPixelOffset;
        tunerBar.style.left = `calc(50% + ${offset}px)`;
    
        // Interpolate color: 0 cents → green, max deviation → red.
        const normalized = Math.min(1, Math.abs(cents) / maxCents);
        const hue = 120 * (1 - normalized);
        tunerBar.style.backgroundColor = `hsl(${hue}, 100%, 50%)`;
      } else {
        frequencyDisplay.textContent = '--';
        noteDisplay.textContent = '--';
        centsDisplay.textContent = '--';
        tunerBar.style.left = `calc(50% - 15px)`;
        tunerBar.style.backgroundColor = '#666';
      }
      rafID = requestAnimationFrame(updatePitch);
    }
    
    /**
     * Auto-correlation algorithm for pitch detection.
     * Returns the detected frequency (Hz) or -1 if signal is too weak.
     */
    function autoCorrelate(buffer, sampleRate) {
      const SIZE = buffer.length;
      let rms = 0;
      for (let i = 0; i < SIZE; i++) {
        rms += buffer[i] * buffer[i];
      }
      rms = Math.sqrt(rms / SIZE);
      if (rms < 0.01) return -1;  // Too weak
    
      const correlations = new Array(SIZE).fill(0);
      for (let lag = 0; lag < SIZE; lag++) {
        let sum = 0;
        for (let i = 0; i < SIZE - lag; i++) {
          sum += buffer[i] * buffer[i + lag];
        }
        correlations[lag] = sum;
      }
    
      const minLag = Math.floor(sampleRate / 1000); // ~48 samples for 1000 Hz at 48000 Hz
      const maxLag = Math.floor(sampleRate / 80);     // ~600 samples for 80 Hz at 48000 Hz
      let bestLag = -1;
      let maxVal = -Infinity;
      for (let lag = minLag; lag <= maxLag; lag++) {
        if (correlations[lag] > maxVal) {
          maxVal = correlations[lag];
          bestLag = lag;
        }
      }
      if (bestLag === -1) return -1;
      return sampleRate / bestLag;
    }
    
    /**
     * Converts a frequency (Hz) to the nearest musical note and calculates cents offset.
     * A4 (440 Hz) is note 69.
     */
    function frequencyToNote(freq) {
      const noteStrings = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      const noteNum = 12 * (Math.log(freq / 440) / Math.log(2)) + 69;
      const roundedNote = Math.round(noteNum);
      const noteIndex = (roundedNote % 12);
      const octave = Math.floor(roundedNote / 12) - 1;
      const cents = (noteNum - roundedNote) * 100;
      return {
        note: noteStrings[noteIndex],
        octave: octave,
        cents: cents,
        frequency: freq
      };
    }
  });
  