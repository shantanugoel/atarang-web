"""Convert the CREMA chord model to the three heads this app decodes. See README.md."""
import json, os, pickle
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

trimmed = keras.Model(full.inputs,
                      [full.get_layer('chord_pitch').output,
                       full.get_layer('chord_bass').output,
                       full.get_layer('chord_tag').output],
                      name="crema_chord")
spec = (tf.TensorSpec((1, None, 216, 2), tf.float32, name="cqt"),)
proto, _ = tf2onnx.convert.from_keras(trimmed, input_signature=spec, opset=17, output_path="crema-chord.onnx")
print("onnx outputs:", [o.name for o in proto.graph.output])

# The chord_tag head is a softmax over named classes, and nothing in the graph
# records which name each index means. `vocabulary()` is NOT that order — pumpp
# fits a LabelEncoder on it, and sklearn sorts, so the model's index order is
# `encoder.classes_`. Reading the wrong one transposes every chord the app
# prints, silently and plausibly, so the order is exported from the checkpoint's
# own encoder rather than written down here.
import crema
pump = pickle.load(open(os.path.join(os.path.dirname(crema.__file__), 'models', 'chord', 'pump.pkl'), 'rb'))
labels = [str(label) for label in pump['chord_tag'].encoder.classes_]
tag_dimension = int(trimmed.outputs[2].shape[-1])
assert len(labels) == tag_dimension, f"{len(labels)} labels for {tag_dimension} outputs"
json.dump(labels, open("crema-chord-vocabulary.json", "w"), separators=(",", ":"))
print("vocabulary:", len(labels), labels[:3], "...", labels[-3:])

# Never ship a graph that has not been compared against the checkpoint it came from.
import onnxruntime as ort
rng = np.random.default_rng(0)
probe = (rng.random((1, 64, 216, 2), dtype=np.float32) * 80 - 80).astype(np.float32)
expected = [np.asarray(o) for o in trimmed.predict(probe, verbose=0)]
session = ort.InferenceSession("crema-chord.onnx")
actual = session.run(None, {session.get_inputs()[0].name: probe})
worst = max(float(np.abs(a - b).max()) for a, b in zip(expected, actual))
print("max abs difference from Keras:", worst)
assert worst < 1e-4, "ONNX graph disagrees with the checkpoint"
print("bytes:", os.path.getsize("crema-chord.onnx"))
