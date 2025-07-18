'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Mic, MicOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

const VoiceRecorder = ({ onTranscription, isDisabled = false }) => {
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])

  // Verificar soporte del navegador
  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast.error("Tu navegador no soporta grabación de audio")
    }
  }, [])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        } 
      })
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      })
      
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        await processAudio(audioBlob)
        
        // Detener todas las pistas de audio
        stream.getTracks().forEach(track => track.stop())
      }

      mediaRecorder.start()
      setIsRecording(true)
      toast.success("Grabación iniciada. Dicta las medidas claramente.")
      
    } catch (error) {
      console.error('Error al acceder al micrófono:', error)
      toast.error("No se pudo acceder al micrófono. Verifica los permisos.")
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      setIsProcessing(true)
      toast.info("Procesando audio...")
    }
  }

  const processAudio = async (audioBlob) => {
    try {
      // Convertir webm a mp3 si es necesario (para mejor compatibilidad con Whisper)
      const audioFile = new File([audioBlob], 'recording.webm', { type: 'audio/webm' })
      
      // Llamar a la API de Whisper
      const transcription = await transcribeAudio(audioFile)
      
      if (transcription) {
        // Parsear la transcripción para extraer medidas
        const parsedMeasures = parseMeasuresFromText(transcription)
        
        if (parsedMeasures.length > 0) {
          onTranscription(parsedMeasures, transcription)
          toast.success(`Se detectaron ${parsedMeasures.length} medida(s) en el audio`)
        } else {
          toast.warning("No se detectaron medidas válidas en el audio")
          onTranscription([], transcription)
        }
      }
      
    } catch (error) {
      console.error('Error procesando audio:', error)
      toast.error("Error al procesar el audio")
    } finally {
      setIsProcessing(false)
    }
  }

  const transcribeAudio = async (audioFile) => {
    const formData = new FormData()
    formData.append('file', audioFile)
    formData.append('model', 'whisper-1')
    formData.append('language', 'es')
    formData.append('prompt', `Eres un asistente experto en fabricación de ventanas y vidrios. Recibirás una transcripción de audio donde un usuario describe las medidas de una ventana o vidrio, a veces de forma desordenada o con unidades variadas (milímetros, centímetros, metros). Tu tarea es:

1. Analiza cuidadosamente la descripción y extrae las medidas de los 4 lados: superior, inferior, izquierdo y derecho.
2. Si el usuario menciona solo dos medidas (ancho y alto), asígnalas a los lados correspondientes (superior/inferior = ancho, izquierdo/derecho = alto).
3. Si el usuario da 4 medidas distintas, asígnalas según la descripción (por ejemplo: "el lado izquierdo mide 1200, el derecho 1210...").
4. Convierte todas las medidas a milímetros, aunque el usuario hable en centímetros o metros.
5. Si la ventana está descuadrada (los lados opuestos no miden igual), respeta las medidas dadas.
6. Si hay dudas, explica brevemente tu razonamiento.
7. Devuelve la respuesta en formato JSON, por ejemplo:

{
  "superior": 1200,
  "inferior": 1200,
  "izquierdo": 1500,
  "derecho": 1505,
  "notas": "El lado derecho es 5mm más largo según la descripción."
}

Transcripción de audio: {AQUÍ VA LA TRANSCRIPCIÓN}`)

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NEXT_PUBLIC_OPENAI_API_KEY}`
      },
      body: formData
    })

    if (!response.ok) {
      throw new Error('Error en la transcripción de audio')
    }

    const data = await response.json()
    return data.text
  }

  const parseMeasuresFromText = (text) => {
    const measures = []
    
    // Patrones para detectar medidas
    const patterns = [
      /\d+\s*(?:unidad|unidades|pieza|piezas)?\s*(?:de)?\s*(\d+(?:\.\d+)?)\s*(?:por|x|×)\s*(\d+(?:\.\d+)?)\s*(?:bordo|borde)?\s*([\w\s\d]+)?/gi,
      /\d+(?:\.\d+)?\s*(?:por|x|×)\s*(\d+(?:\.\d+)?)\s*(?:cantidad|cant)?\s*(\d+)?\s*(?:bordo|borde)?\s*([\w\s\d]+)?/gi,
      /(?:largo|l)\s*(\d+(?:\.\d+)?)\s*(?:ancho|a)\s*(\d+(?:\.\d+)?)\s*(?:cantidad|cant)?\s*(\d+)?/gi
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(text)) !== null) {
        let cantidad, largo, ancho, bordoText
        if (pattern.source.includes("largo") && pattern.source.includes("ancho")) {
          largo = match[1]
          ancho = match[2]
          cantidad = match[3] || 1
          bordoText = "1 largo"
        } else if (pattern.source.includes("unidad")) {
          cantidad = match[1]
          largo = match[2]
          ancho = match[3]
          bordoText = match[4] || "1 largo"
        } else {
          largo = match[1]
          ancho = match[2]
          cantidad = match[3] || 1
          bordoText = match[4] || "1 largo"
        }
        const parsedLargo = parseFloat(largo)
        const parsedAncho = parseFloat(ancho)
        if (isNaN(parsedLargo) || isNaN(parsedAncho) || parsedLargo <= 0 || parsedAncho <= 0) {
          continue
        }
        const bordoMapping = {
          "1 lado largo": "1-largo",
          "un lado largo": "1-largo",
          "1 largo": "1-largo",
          "un largo": "1-largo",
          "1 lado largo y 1 lado corto": "1-largo-1-corto",
          "un lado largo y un lado corto": "1-largo-1-corto",
          "1 largo 1 corto": "1-largo-1-corto",
          "un largo un corto": "1-largo-1-corto",
          "1 lado largo y 2 lados cortos": "1-largo-2-cortos",
          "un lado largo y dos lados cortos": "1-largo-2-cortos",
          "1 largo 2 cortos": "1-largo-2-cortos",
          "un largo dos cortos": "1-largo-2-cortos",
          "4 lados": "4-lados",
          "cuatro lados": "4-lados",
          "todos los lados": "4-lados"
        }
        const tipoBordo = bordoMapping[bordoText ? bordoText.toLowerCase().trim() : ""] || "1-largo"
        measures.push({
          cantidad: parseInt(cantidad),
          largo: parsedLargo,
          ancho: parsedAncho,
          tipoBordo: tipoBordo,
          perforacion: "ninguna",
          cantoBordo: "canto-suave"
        })
      }
    }
    return measures
  }

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }

  return (
    <div className="flex flex-col items-center space-y-2">
      <Button
        onClick={toggleRecording}
        disabled={isDisabled || isProcessing}
        className={`w-16 h-16 rounded-full ${
          isRecording 
            ? 'bg-red-600 hover:bg-red-700 animate-pulse' 
            : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {isProcessing ? (
          <Loader2 className="w-6 h-6 animate-spin" />
        ) : isRecording ? (
          <MicOff className="w-6 h-6" />
        ) : (
          <Mic className="w-6 h-6" />
        )}
      </Button>
      
      <p className="text-sm text-gray-600 text-center">
        {isProcessing 
          ? "Procesando audio..." 
          : isRecording 
            ? "Grabando... Haz clic para detener" 
            : "Haz clic para grabar medidas"
        }
      </p>
      
      {isRecording && (
        <p className="text-xs text-gray-500 text-center max-w-xs">
          Ejemplo: "1 unidad de 120 por 60 bordo 4 lados"
        </p>
      )}
    </div>
  )
}

export default VoiceRecorder

