import mongoose from "mongoose";

const contactSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  }
});

export default mongoose.model("Contact", contactSchema);
