document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const audioSelect = document.getElementById('audioSource');
  const message = document.getElementById('message');
  const frequencyDisplay = document.getElementById('frequency');
  const noteDisplay = document.getElementById('note');
  const centsDisplay = document.getElementById('cents');
  const tunerBar = document.getElementById('tunerBar');
  const testModeCheckbox = document.getElementById('testModeCheckbox');
  const testFrequencyInput = document.getElementById('testFrequency');
  const volumeSlider = document.getElementById('volumeSlider');
  const refAFrequencyInput = document.getElementById('refAFrequency');
  const tuningSelect = document.getElementById('tuningSelect');
  const customTuningInputs = document.getElementById('customTuningInputs');
  const stringButtons = document.querySelectorAll('.string-button');

  // Global reference pitch variable (default A = 440 Hz)
  let referenceA = parseFloat(refAFrequencyInput.value) || 440;

  // Preset tunings (using note strings from low to high)
  const tunings = {
    "Standard": ["E2", "A2", "D3", "G3", "B3", "E4"],
    "Drop D":   ["D2", "A2", "D3", "G3", "B3", "E4"],
    "Open G":   ["D2", "G2", "D3", "G3", "B3", "D4"],
    "DADGAD":   ["D2", "A2", "D3", "G3", "A3", "D4"],
    "Drop C":   ["C2", "G2", "C3", "F3", "A3", "D4"],
    "Custom":   null
  };

  // Helper: Parse a note string (like "C#3") into its note and octave parts.
  function parseNoteString(noteStr) {
    const match = noteStr.match(/^([A-G]#?)(\d)$/);
    if(match){
      return { note: match[1], octave: parseInt(match[2], 10) };
    }
    return { note: "E", octave: 4 };
  }

  // Request audio input access so device labels can be displayed.
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
      // Automatically start the tuner once devices are available.
      startTuner();
    })
    .catch(error => {
      console.error('Error accessing media devices:', error);
      message.textContent = 'Error accessing media devices: ' + error.message;
    });
  
  let audioContext;
  let analyser;
  let microphone;
  let testOscillator; // For test mode.
  let globalGainNode; // For volume control.
  let rafID;
  
  // Smoothing for cents offset.
  let smoothedCents = 0;
  const smoothingFactor = 0.15;
  
  // Function to (re)start the tuner based on current settings.
  function startTuner() {
    // Stop any previous test oscillator.
    if (testOscillator) {
      testOscillator.stop();
      testOscillator.disconnect();
      testOscillator = null;
    }
    // Disconnect previous microphone if any.
    if (microphone) {
      microphone.disconnect();
      microphone = null;
    }
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Create or update the global gain node.
    globalGainNode = audioContext.createGain();
    globalGainNode.gain.value = parseFloat(volumeSlider.value);
    
    if (testModeCheckbox.checked) {
      // Use test mode: create a test oscillator.
      const testFreq = parseFloat(testFrequencyInput.value) || 440;
      testOscillator = audioContext.createOscillator();
      testOscillator.frequency.setValueAtTime(testFreq, audioContext.currentTime);
      testOscillator.type = 'sine';
      
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 8192;
      testOscillator.connect(globalGainNode);
      globalGainNode.connect(audioContext.destination);
      
      testOscillator.start();
      message.textContent = `Test tone started at ${testFreq} Hz.`;
    } else {
      // Use microphone input.
      const deviceId = audioSelect.value;
      const constraints = { audio: { deviceId: deviceId ? { exact: deviceId } : undefined } };
      navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
          message.textContent = 'Audio stream started.';
          microphone = audioContext.createMediaStreamSource(stream);
          analyser = audioContext.createAnalyser();
          analyser.fftSize = 8192;
          microphone.connect(analyser);
        })
        .catch(error => {
          console.error('Error starting audio stream:', error);
          message.textContent = 'Error starting audio stream: ' + error.message;
        });
    }
  }
  
  // Listen for changes to automatically restart or update.
  audioSelect.addEventListener('change', startTuner);
  testModeCheckbox.addEventListener('change', startTuner);
  testFrequencyInput.addEventListener('input', () => {
    if (testModeCheckbox.checked && testOscillator) {
      const testFreq = parseFloat(testFrequencyInput.value) || 440;
      testOscillator.frequency.setValueAtTime(testFreq, audioContext.currentTime);
      message.textContent = `Test tone updated to ${testFreq} Hz.`;
    }
  });
  volumeSlider.addEventListener('input', () => {
    if (globalGainNode) {
      globalGainNode.gain.value = parseFloat(volumeSlider.value);
    }
  });
  refAFrequencyInput.addEventListener('input', () => {
    // Update the global A reference and then update any open–string frequencies.
    referenceA = parseFloat(refAFrequencyInput.value) || 440;
    updateOpenStrings();
  });
  
  // Update open string buttons based on the selected tuning.
  function updateOpenStrings() {
    let tuningArray;
    const selectedTuning = tuningSelect.value;
    if (selectedTuning === "Custom") {
      tuningArray = [
        getFrequencyFromNote(document.getElementById('customString6_note').value,
                             document.getElementById('customString6_octave').value),
        getFrequencyFromNote(document.getElementById('customString5_note').value,
                             document.getElementById('customString5_octave').value),
        getFrequencyFromNote(document.getElementById('customString4_note').value,
                             document.getElementById('customString4_octave').value),
        getFrequencyFromNote(document.getElementById('customString3_note').value,
                             document.getElementById('customString3_octave').value),
        getFrequencyFromNote(document.getElementById('customString2_note').value,
                             document.getElementById('customString2_octave').value),
        getFrequencyFromNote(document.getElementById('customString1_note').value,
                             document.getElementById('customString1_octave').value)
      ];
    } else {
      // For presets, convert note strings to frequencies using the current referenceA.
      tuningArray = tunings[selectedTuning].map(noteStr => {
        const { note, octave } = parseNoteString(noteStr);
        return getFrequencyFromNote(note, octave);
      });
    }
    // Update each string button's data and label.
    stringButtons.forEach((button, index) => {
      const freq = tuningArray[index];
      const noteData = frequencyToNote(freq);
      button.setAttribute('data-frequency', freq);
      button.textContent = `${noteData.note}${noteData.octave} (${freq.toFixed(2)} Hz)`;
    });
  }
  
  tuningSelect.addEventListener('change', () => {
    if (tuningSelect.value === "Custom") {
      customTuningInputs.style.display = "flex";
    } else {
      customTuningInputs.style.display = "none";
    }
    updateOpenStrings();
  });
  
  // Update open strings when any custom tuning selection changes.
  customTuningInputs.querySelectorAll('select').forEach(select => {
    select.addEventListener('change', updateOpenStrings);
  });
  
  // Initialize open string buttons with the default (Standard) tuning.
  updateOpenStrings();
  
  // When an open string button is clicked, play its tone for 1 second.
  stringButtons.forEach(button => {
    button.addEventListener('click', () => {
      const freq = parseFloat(button.getAttribute('data-frequency'));
      playTone(freq, 1);
    });
  });
  
  // Function to play a tone (used for open string buttons).
  function playTone(freq, duration) {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    const osc = audioContext.createOscillator();
    osc.frequency.setValueAtTime(freq, audioContext.currentTime);
    osc.type = 'sine';
    
    const tempGain = audioContext.createGain();
    tempGain.gain.value = parseFloat(volumeSlider.value);
    osc.connect(tempGain);
    tempGain.connect(audioContext.destination);
    
    osc.start();
    osc.stop(audioContext.currentTime + duration);
  }
  
  // Continuously analyze the audio (or test tone) and update the tuner display.
  function updatePitch() {
    if (!analyser) {
      rafID = requestAnimationFrame(updatePitch);
      return;
    }
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
      let cents = smoothedCents;
      if (cents < -maxCents) cents = -maxCents;
      if (cents > maxCents) cents = maxCents;
      // Map cents from [-50, +50] to [0, 100]%
      const pct = (cents + maxCents) / (2 * maxCents);
      // Adjust for the needle width (assuming 30px width; subtract half)
      tunerBar.style.left = `calc(${pct * 100}% - 15px)`;
  
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
  
  // Improved auto-correlation function with parabolic interpolation.
  function autoCorrelate(buffer, sampleRate) {
    const SIZE = buffer.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) {
      rms += buffer[i] * buffer[i];
    }
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1;  // Not enough signal

    // Compute the correlation for each lag
    const correlations = new Array(SIZE).fill(0);
    for (let lag = 0; lag < SIZE; lag++) {
      let sum = 0;
      for (let i = 0; i < SIZE - lag; i++) {
        sum += buffer[i] * buffer[i + lag];
      }
      correlations[lag] = sum;
    }

    // Define the lag search range.
    const minLag = Math.floor(sampleRate / 1000); // e.g., ~44 samples for 44100Hz (for 1000Hz)
    const maxLag = Math.floor(sampleRate / 20);     // e.g., ~2205 samples for 44100Hz (for 20Hz)
    let bestLag = -1;
    let maxVal = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (correlations[lag] > maxVal) {
        maxVal = correlations[lag];
        bestLag = lag;
      }
    }
    
    if (bestLag === -1) return -1;
    
    // Parabolic interpolation: refine the peak by comparing neighbors.
    if (bestLag > 0 && bestLag < correlations.length - 1) {
      const left = correlations[bestLag - 1];
      const center = correlations[bestLag];
      const right = correlations[bestLag + 1];
      const denominator = (2 * center - left - right);
      if (denominator !== 0) {
        const delta = (right - left) / (2 * denominator);
        bestLag = bestLag + delta;  // bestLag becomes a fractional lag
      }
    }
    
    return sampleRate / bestLag;
  }
  
  // Converts a frequency (Hz) to the nearest musical note and cents offset using the current referenceA.
  function frequencyToNote(freq) {
    const noteStrings = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const noteNum = 12 * (Math.log(freq / referenceA) / Math.log(2)) + 69;
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
  
  // Compute frequency from a note (string) and octave using the current referenceA.
  function getFrequencyFromNote(note, octave) {
    const noteMap = { "C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11 };
    const midi = 12 * (parseInt(octave) + 1) + noteMap[note];
    return referenceA * Math.pow(2, (midi - 69) / 12);
  }
  
  // Start the pitch detection loop.
  updatePitch();
});
