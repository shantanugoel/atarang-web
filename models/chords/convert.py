"""Convert the CREMA chord model to the two heads this app decodes. See README.md."""
import keras, tensorflow as tf, numpy as np, tf2onnx
import keras.backend as K
from keras.layers import Layer

class SqueezeLayer(Layer):
    def __init__(self, axis=-1, **kwargs):
        super().__init__(**kwargs); self.axis=axis
    def compute_output_shape(self, input_shape):
        shape=list(input_shape); del shape[self.axis]; return tuple(shape)
    def call(self, x, mask=None): return K.squeeze(x, axis=self.axis)
    def get_config(self): return {**super().get_config(), 'axis': self.axis}

full = keras.models.load_model('crema/models/chord/model.h5', custom_objects={'SqueezeLayer': SqueezeLayer}, compile=False)
for layer in full.layers:
    if layer.__class__.__name__=="Bidirectional":
        print("RNN:", layer.name, layer.forward_layer.__class__.__name__, "units", layer.forward_layer.units)

trimmed = keras.Model(full.inputs, [full.get_layer('chord_pitch').output, full.get_layer('chord_bass').output], name="crema_chord_pitch")
spec = (tf.TensorSpec((1, None, 216, 2), tf.float32, name="cqt"),)
proto, _ = tf2onnx.convert.from_keras(trimmed, input_signature=spec, opset=17, output_path="crema-chord-pitch.onnx")
print("onnx outputs:", [o.name for o in proto.graph.output])

# Never ship a graph that has not been compared against the checkpoint it came from.
import onnxruntime as ort
rng = np.random.default_rng(0)
probe = (rng.random((1, 64, 216, 2), dtype=np.float32) * 80 - 80).astype(np.float32)
expected = [np.asarray(o) for o in trimmed.predict(probe, verbose=0)]
session = ort.InferenceSession("crema-chord-pitch.onnx")
actual = session.run(None, {session.get_inputs()[0].name: probe})
worst = max(float(np.abs(a - b).max()) for a, b in zip(expected, actual))
print("max abs difference from Keras:", worst)
assert worst < 1e-4, "ONNX graph disagrees with the checkpoint"
print("bytes:", len(open("crema-chord-pitch.onnx", "rb").read()))
