import Contact from "../model/contactModel.js";

// CREATE or UPDATE single contact
export const saveContact = async (req, res) => {
  try {
    const { phoneNumber, email } = req.body;

    // check if a contact already exists
    let existingContact = await Contact.findOne();

    if (!existingContact) {
      // create new
      const newContact = await Contact.create({ phoneNumber, email });
      return res.status(201).json({
        message: "Contact created successfully",
        data: newContact
      });
    }

    // update existing
    existingContact.phoneNumber = phoneNumber;
    existingContact.email = email;
    await existingContact.save();

    res.status(200).json({
      message: "Contact updated successfully",
      data: existingContact
    });

  } catch (error) {
    res.status(500).json({
      message: "Error processing request",
      error: error.message,
    });
  }
};

// GET Contact (always returns the single one)
export const getContact = async (req, res) => {
  try {
    const contact = await Contact.findOne();

    res.status(200).json({
      data: contact
    });
  } catch (error) {
    res.status(500).json({
      message: "Error fetching contact",
      error: error.message,
    });
  }
};
